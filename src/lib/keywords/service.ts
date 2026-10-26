/**
 * Keyword research + rank tracking orchestration (server only).
 * Callers must authorize the user for the website first. Provider data is
 * written with the service role only — clients cannot write metrics/positions.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { getKeywordProvider, getRankProvider } from "@/lib/providers/registry";
import { ProviderError, type KeywordIdea, type KeywordMetrics, type KeywordProvider, type Market, type RankProvider } from "@/lib/providers/types";
import { ideaType, normalizeKeyword } from "./utils";

type Website = Tables<"websites">;
const CACHE_DAYS = 7;

export interface StoredIdea extends KeywordIdea {
  type: ReturnType<typeof ideaType>;
}

function monthStart() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

async function planLimits(planId: string) {
  const db = createAdminClient();
  const { data } = await db.from("plans").select("limits").eq("id", planId).single();
  return (data?.limits ?? {}) as Record<string, number>;
}

export async function usageThisMonth(orgId: string, metric: "keyword_lookups" | "rank_checks") {
  const db = createAdminClient();
  const { data } = await db.from("usage_records").select("quantity").eq("organization_id", orgId).eq("metric", metric).gte("occurred_at", monthStart());
  return (data ?? []).reduce((a, r) => a + r.quantity, 0);
}

// ---------------------------------------------------------------------------
// Research
// ---------------------------------------------------------------------------
export type ResearchOutcome =
  | { ok: true; queryId: string; cached: boolean }
  | { ok: false; reason: "not_connected" | "quota" | "provider_error"; message: string };

export async function researchKeywords(opts: {
  website: Website;
  planId: string;
  userId: string;
  seed: string;
  market: Market;
  /** test/ops injection; defaults to the configured provider */
  provider?: KeywordProvider | null;
}): Promise<ResearchOutcome> {
  const provider = opts.provider !== undefined ? opts.provider : getKeywordProvider({ isDemoWebsite: opts.website.is_demo });
  if (!provider) return { ok: false, reason: "not_connected", message: "No keyword data provider is connected." };
  const db = createAdminClient();
  const seed = normalizeKeyword(opts.seed);

  // Cache: identical seed + market + provider within 7 days (no extra provider cost)
  const since = new Date(Date.now() - CACHE_DAYS * 86_400_000).toISOString();
  const { data: cached } = await db
    .from("keyword_research_queries")
    .select("id")
    .eq("organization_id", opts.website.organization_id)
    .eq("seed", seed)
    .eq("country_code", opts.market.countryCode)
    .eq("language_code", opts.market.languageCode)
    .eq("provider", provider.id)
    .eq("status", "completed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cached) return { ok: true, queryId: cached.id, cached: true };

  if (provider.id !== "demo") {
    const limit = (await planLimits(opts.planId)).keyword_lookups_per_month ?? 50;
    if ((await usageThisMonth(opts.website.organization_id, "keyword_lookups")) >= limit) {
      return { ok: false, reason: "quota", message: `Your plan includes ${limit} keyword lookups per month. The limit has been reached.` };
    }
  }

  try {
    const ideas = await provider.ideas(seed, opts.market, { limit: 150 });
    const results: StoredIdea[] = ideas.map((i) => ({ ...i, keyword: normalizeKeyword(i.keyword), type: ideaType(i.keyword) }));
    const { data, error } = await db
      .from("keyword_research_queries")
      .insert({
        organization_id: opts.website.organization_id,
        website_id: opts.website.id,
        seed,
        country_code: opts.market.countryCode,
        language_code: opts.market.languageCode,
        provider: provider.id,
        status: "completed",
        results: results as unknown as Json,
        requested_by: opts.userId,
      })
      .select("id")
      .single();
    if (error || !data) throw new Error(error?.message ?? "insert failed");
    if (provider.id !== "demo") {
      await db.from("usage_records").insert({ organization_id: opts.website.organization_id, website_id: opts.website.id, metric: "keyword_lookups", quantity: 1, metadata: { seed } });
    }
    return { ok: true, queryId: data.id, cached: false };
  } catch (e) {
    const message = e instanceof ProviderError ? e.message : "The keyword provider request failed.";
    console.error("[keywords.research]", e);
    await db.from("keyword_research_queries").insert({
      organization_id: opts.website.organization_id,
      website_id: opts.website.id,
      seed,
      country_code: opts.market.countryCode,
      language_code: opts.market.languageCode,
      provider: provider.id,
      status: "failed",
      error: message.slice(0, 500),
      requested_by: opts.userId,
    });
    return { ok: false, reason: "provider_error", message };
  }
}

/** Write provider metrics onto keyword rows (service role). */
export async function applyMetrics(keywordIds: Map<string, string>, metrics: KeywordMetrics[], providerId: string, fetchedAt = new Date().toISOString()) {
  const db = createAdminClient();
  for (const m of metrics) {
    const id = keywordIds.get(normalizeKeyword(m.keyword));
    if (!id) continue;
    await db
      .from("keywords")
      .update({
        search_volume: m.searchVolume,
        cpc: m.cpc,
        competition: m.competition,
        difficulty: m.difficulty,
        intent: m.intent,
        search_volume_trend: (m.monthlySearches ?? null) as unknown as Json,
        metrics_source: providerId,
        metrics_fetched_at: fetchedAt,
      })
      .eq("id", id);
  }
}

/** Fetch fresh metrics for saved keywords (grouped by market). */
export async function refreshMetrics(opts: { website: Website; planId: string; keywordIds: string[] }) {
  const provider = getKeywordProvider({ isDemoWebsite: false });
  if (!provider || opts.website.is_demo) return { ok: false as const, message: "No keyword data provider is connected." };
  const db = createAdminClient();
  const { data: rows } = await db
    .from("keywords")
    .select("id, normalized_keyword, country_code, language_code")
    .eq("website_id", opts.website.id)
    .in("id", opts.keywordIds.slice(0, 700));
  const markets = new Map<string, NonNullable<typeof rows>>();
  for (const r of rows ?? []) {
    const k = `${r.country_code}|${r.language_code}`;
    markets.set(k, [...(markets.get(k) ?? []), r]);
  }
  const limit = (await planLimits(opts.planId)).keyword_lookups_per_month ?? 50;
  if ((await usageThisMonth(opts.website.organization_id, "keyword_lookups")) + markets.size > limit) {
    return { ok: false as const, message: `Your plan includes ${limit} keyword lookups per month. The limit has been reached.` };
  }
  let updated = 0;
  try {
    for (const [market, list] of markets) {
      const [countryCode, languageCode] = market.split("|");
      const metrics = await provider.metrics(list.map((r) => r.normalized_keyword), { countryCode, languageCode });
      await applyMetrics(new Map(list.map((r) => [r.normalized_keyword, r.id])), metrics, provider.id);
      updated += metrics.length;
      await db.from("usage_records").insert({ organization_id: opts.website.organization_id, website_id: opts.website.id, metric: "keyword_lookups", quantity: 1, metadata: { refresh: list.length } });
    }
  } catch (e) {
    return { ok: false as const, message: e instanceof ProviderError ? e.message : "The keyword provider request failed." };
  }
  return { ok: true as const, updated };
}

// ---------------------------------------------------------------------------
// Rank checks
// ---------------------------------------------------------------------------
export const CLAIM_TTL_MS = 180_000;
const CONCURRENCY = 4;

export function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

export async function dueKeywordCount(websiteId: string) {
  const db = createAdminClient();
  const { count } = await db
    .from("keywords")
    .select("id", { count: "exact", head: true })
    .eq("website_id", websiteId)
    .eq("is_tracked", true)
    .or(`last_checked_on.is.null,last_checked_on.lt.${todayUtc()}`);
  return count ?? 0;
}

export interface RankBatchResult {
  checked: number;
  failed: number;
  remaining: number;
  errors: string[];
}

/**
 * Check up to `max` due keywords for one website. Keywords are claimed first
 * (rank_check_claimed_at) so parallel workers never pay twice for one check.
 */
export async function runRankBatch(
  website: Website,
  opts: { max?: number; budgetMs?: number; provider?: RankProvider | null } = {},
): Promise<RankBatchResult> {
  const provider = opts.provider !== undefined ? opts.provider : getRankProvider();
  if (!provider || website.is_demo) throw new ProviderError("No rank tracking provider is connected", "none");
  const db = createAdminClient();
  const started = Date.now();
  const budget = opts.budgetMs ?? 20_000;
  const max = opts.max ?? 20;
  const today = todayUtc();
  let checked = 0;
  let failed = 0;
  const errors: string[] = [];

  while (checked + failed < max && Date.now() - started < budget * 0.7) {
    const staleClaim = new Date(Date.now() - CLAIM_TTL_MS).toISOString();
    const { data: due } = await db
      .from("keywords")
      .select("id, rank_check_claimed_at")
      .eq("website_id", website.id)
      .eq("is_tracked", true)
      .or(`last_checked_on.is.null,last_checked_on.lt.${today}`)
      .order("last_checked_on", { ascending: true, nullsFirst: true })
      .limit(CONCURRENCY * 5);
    const candidates = (due ?? [])
      .filter((k) => !k.rank_check_claimed_at || new Date(k.rank_check_claimed_at).getTime() < Date.now() - CLAIM_TTL_MS)
      .slice(0, CONCURRENCY);
    if (!candidates.length) break;
    const { data: claimed } = await db
      .from("keywords")
      .update({ rank_check_claimed_at: new Date().toISOString() })
      .in("id", candidates.map((c) => c.id))
      .or(`rank_check_claimed_at.is.null,rank_check_claimed_at.lt."${staleClaim}"`)
      .select("id, keyword, country_code, language_code, device, search_engine");
    if (!claimed?.length) break;

    await Promise.all(
      claimed.map(async (k) => {
        try {
          if (!provider.supports(k.search_engine as "google" | "bing")) throw new ProviderError(`${provider.name} does not support ${k.search_engine}`, provider.id);
          const r = await provider.check({
            keyword: k.keyword,
            countryCode: k.country_code,
            languageCode: k.language_code,
            device: k.device as "desktop" | "mobile",
            engine: k.search_engine as "google" | "bing",
            domain: website.domain,
          });
          await db.from("keyword_rankings").upsert(
            {
              organization_id: website.organization_id,
              keyword_id: k.id,
              checked_on: today,
              checked_at: new Date().toISOString(),
              position: r.position,
              ranking_url: r.url,
              serp_features: r.serpFeatures,
              source: provider.id,
            },
            { onConflict: "keyword_id,checked_on" },
          );
          checked++;
        } catch (e) {
          failed++;
          errors.push(`${k.keyword}: ${(e as Error).message}`.slice(0, 200));
        } finally {
          await db.from("keywords").update({ rank_check_claimed_at: null }).eq("id", k.id);
        }
      }),
    );
  }

  if (checked > 0) {
    await db.from("usage_records").insert({ organization_id: website.organization_id, website_id: website.id, metric: "rank_checks", quantity: checked });
  }
  return { checked, failed, remaining: await dueKeywordCount(website.id), errors: errors.slice(0, 5) };
}

/** How many more keywords an organization may track under its plan. */
export async function trackingRoom(orgId: string, planId: string) {
  const db = createAdminClient();
  const limit = (await planLimits(planId)).tracked_keywords ?? 25;
  const { count } = await db.from("keywords").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("is_tracked", true);
  return { limit, used: count ?? 0, room: Math.max(0, limit - (count ?? 0)) };
}
