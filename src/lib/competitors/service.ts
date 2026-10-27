import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Json, Tables } from "@/lib/supabase/database.types";
import { createSafeFetcher } from "@/lib/crawler/fetcher";
import { parsePage } from "@/lib/crawler/parse-page";
import { isAllowed, parseRobots } from "@/lib/crawler/robots";
import { isSameSite } from "@/lib/crawler/url";
import { DEFAULT_USER_AGENT } from "@/lib/security/safe-fetch";
import { parsePublicUrl, UnsafeUrlError } from "@/lib/security/url-safety";
import { getDomainKeywordProvider } from "@/lib/providers/registry";
import { ProviderError, type RankedKeyword } from "@/lib/providers/types";
import { planLimits, usageThisMonth } from "@/lib/keywords/service";
import { analyzeContent, type ContentCheck } from "@/lib/content/analyze";
import { documentFromHtml } from "@/lib/content/document";
import { failedSnapshot, KEYWORD_SNAPSHOT_TTL_DAYS, snapshotFromPage, type TechnicalSnapshot } from "./compare";

type Website = Tables<"websites">;
type Competitor = Tables<"competitors">;

export type ServiceResult = { ok: true; id?: string; cached?: boolean } | { ok: false; reason: "not_connected" | "quota" | "provider_error" | "invalid_url" | "fetch_failed"; message: string };

// ---------------------------------------------------------------------------
// Ranked-keyword snapshots (overlap & gaps)
// ---------------------------------------------------------------------------
export async function refreshDomainKeywords(opts: { website: Website; competitor: Competitor | null; userId: string; planId: string; force?: boolean }): Promise<ServiceResult> {
  const { website, competitor } = opts;
  const domain = competitor?.domain ?? website.domain;
  const db = createAdminClient();
  if (!opts.force) {
    const since = new Date(Date.now() - KEYWORD_SNAPSHOT_TTL_DAYS * 86_400_000).toISOString();
    const { data: cached } = await db
      .from("domain_keyword_snapshots")
      .select("id")
      .eq("website_id", website.id)
      .eq("domain", domain)
      .eq("country_code", website.country_code)
      .gte("fetched_at", since)
      .limit(1)
      .maybeSingle();
    if (cached) return { ok: true, id: cached.id, cached: true };
  }
  const provider = getDomainKeywordProvider();
  if (!provider) return { ok: false, reason: "not_connected", message: "No keyword data provider is connected." };
  const limit = (await planLimits(opts.planId)).keyword_lookups_per_month ?? 50;
  if ((await usageThisMonth(website.organization_id, "keyword_lookups")) >= limit) {
    return { ok: false, reason: "quota", message: `Your plan includes ${limit} keyword lookups per month.` };
  }
  let result: { total: number | null; items: RankedKeyword[] };
  try {
    result = await provider.rankedKeywords(domain, { countryCode: website.country_code, languageCode: website.language_code }, { limit: 1000 });
  } catch (e) {
    return { ok: false, reason: "provider_error", message: e instanceof ProviderError ? e.message : "The provider request failed." };
  }
  const { data, error } = await db
    .from("domain_keyword_snapshots")
    .insert({
      organization_id: website.organization_id,
      website_id: website.id,
      competitor_id: competitor?.id ?? null,
      domain,
      country_code: website.country_code,
      language_code: website.language_code,
      provider: provider.id,
      item_count: result.total ?? result.items.length,
      items: result.items as unknown as Json,
      created_by: opts.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not store keyword snapshot: ${error?.message}`);
  await db.from("usage_records").insert({ organization_id: website.organization_id, website_id: website.id, metric: "keyword_lookups", quantity: 1, metadata: { kind: "ranked_keywords", domain } });
  return { ok: true, id: data.id, cached: false };
}

// ---------------------------------------------------------------------------
// Homepage technical snapshots
// ---------------------------------------------------------------------------
async function homepageSnapshot(domain: string, startUrl: string): Promise<TechnicalSnapshot> {
  const fetcher = createSafeFetcher();
  const origin = new URL(startUrl).origin;
  const robotsRes = await fetcher(`${origin}/robots.txt`, { timeoutMs: 10_000, accept: "text/plain" });
  const robotsOk = robotsRes.ok && robotsRes.status === 200 && !/html/i.test(robotsRes.contentType ?? "");
  const robots = robotsOk ? parseRobots(robotsRes.body) : null;
  // politeness: a site that disallows our bot is not fetched
  if (!isAllowed(robots, DEFAULT_USER_AGENT, new URL(startUrl).pathname || "/")) return failedSnapshot(startUrl, "Blocked by robots.txt for RankoraBot");
  const page = await fetcher(startUrl, { timeoutMs: 15_000, accept: "text/html" });
  if (!page.ok) return failedSnapshot(startUrl, page.error);
  if (!isSameSite(page.finalUrl, domain)) return failedSnapshot(startUrl, `Redirects to another site (${new URL(page.finalUrl).hostname})`);
  let sitemap = Boolean(robots?.sitemaps.length);
  if (!sitemap) {
    const sm = await fetcher(`${origin}/sitemap.xml`, { timeoutMs: 10_000, accept: "application/xml,text/xml" });
    sitemap = sm.ok && sm.status === 200 && /<(urlset|sitemapindex)\b/i.test(sm.body.slice(0, 2000));
  }
  const parsed = parsePage(/html/i.test(page.contentType ?? "") ? page.body : "", page.finalUrl, { xRobotsTag: page.xRobotsTag });
  return snapshotFromPage(startUrl, { status: page.status, finalUrl: page.finalUrl, responseTimeMs: page.responseTimeMs, redirects: page.redirectChain.length }, parsed, { robotsTxt: robotsOk, sitemap });
}

export async function captureHomepageComparison(opts: { website: Website; competitor: Competitor; userId: string }): Promise<ServiceResult> {
  const { website, competitor } = opts;
  // Both homepages are fetched now, with the same checks, so the comparison is like-for-like.
  const [own, theirs] = await Promise.all([homepageSnapshot(website.domain, website.base_url), homepageSnapshot(competitor.domain, `https://${competitor.domain}/`)]);
  const { data, error } = await createAdminClient()
    .from("competitor_snapshots")
    .insert({ organization_id: website.organization_id, website_id: website.id, competitor_id: competitor.id, kind: "homepage", url: theirs.url, own_url: own.url, data: { own, theirs } as unknown as Json, created_by: opts.userId })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not store snapshot: ${error?.message}`);
  return { ok: true, id: data.id };
}

// ---------------------------------------------------------------------------
// Page-vs-page content comparison
// ---------------------------------------------------------------------------
export interface PageSide {
  url: string;
  finalUrl: string | null;
  error: string | null;
  title: string | null;
  score: number | null;
  words: number | null;
  stats: Record<string, unknown> | null;
  checks: Pick<ContentCheck, "id" | "label" | "status" | "detail">[];
  headings: { level: number; text: string }[];
}

async function analyzeSide(url: string, domain: string, keyword: string, language: string): Promise<PageSide> {
  const empty = { finalUrl: null, title: null, score: null, words: null, stats: null, checks: [], headings: [] };
  let parsed: URL;
  try {
    parsed = parsePublicUrl(url);
  } catch (e) {
    return { url, error: e instanceof UnsafeUrlError ? e.message : "Invalid URL", ...empty };
  }
  if (!isSameSite(parsed, domain)) return { url, error: `The URL must be on ${domain}`, ...empty };
  const r = await createSafeFetcher()(parsed.toString(), { timeoutMs: 15_000, accept: "text/html" });
  if (!r.ok) return { url, error: r.error, ...empty };
  if (r.status >= 400) return { url, error: `HTTP ${r.status}`, ...empty };
  if (!/html/i.test(r.contentType ?? "")) return { url, error: "Not an HTML page", ...empty };
  const doc = documentFromHtml(r.body, r.finalUrl);
  const a = analyzeContent(doc, { keyword, language });
  return {
    url,
    finalUrl: r.finalUrl,
    error: null,
    title: doc.title,
    score: a.score,
    words: a.stats.words,
    stats: { ...a.stats, fleschReadingEase: a.readability.fleschReadingEase, avgSentenceWords: a.readability.avgSentenceWords },
    checks: a.checks.map((c) => ({ id: c.id, label: c.label, status: c.status, detail: c.detail })),
    headings: doc.headings.slice(0, 80),
  };
}

export async function comparePages(opts: { website: Website; competitor: Competitor; keyword: string; ownUrl: string; theirUrl: string; userId: string }): Promise<ServiceResult> {
  const { website, competitor } = opts;
  const [own, theirs] = await Promise.all([
    analyzeSide(opts.ownUrl, website.domain, opts.keyword, website.language_code),
    analyzeSide(opts.theirUrl, competitor.domain, opts.keyword, website.language_code),
  ]);
  if (own.error && theirs.error) return { ok: false, reason: "fetch_failed", message: `Your page: ${own.error}. Competitor page: ${theirs.error}.` };
  const { data, error } = await createAdminClient()
    .from("competitor_snapshots")
    .insert({
      organization_id: website.organization_id,
      website_id: website.id,
      competitor_id: competitor.id,
      kind: "page_compare",
      keyword: opts.keyword,
      url: opts.theirUrl.slice(0, 2048),
      own_url: opts.ownUrl.slice(0, 2048),
      data: { keyword: opts.keyword, own, theirs } as unknown as Json,
      created_by: opts.userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not store comparison: ${error?.message}`);
  return { ok: true, id: data.id };
}
