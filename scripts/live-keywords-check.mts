/**
 * End-to-end check of the keyword pipeline against the LIVE database, using a
 * clearly-labelled FAKE provider (source "live-check-fake") so no paid API is
 * called. Creates a temporary user/org/website, then deletes everything.
 *
 *   npm run keywords:live-check
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import { applyMetrics, dueKeywordCount, researchKeywords, runRankBatch, type StoredIdea } from "../src/lib/keywords/service.ts";
import { getKeywordProvider, getRankProvider } from "../src/lib/providers/registry.ts";
import type { KeywordProvider, RankProvider } from "../src/lib/providers/types.ts";

const fakeKeywords: KeywordProvider = {
  id: "live-check-fake",
  name: "Live-check fake",
  async ideas(seed) {
    return [
      { keyword: seed, source: "related", searchVolume: 1000, cpc: 1.5, competition: 0.4, difficulty: 30, intent: "commercial", monthlySearches: null },
      { keyword: `how to choose ${seed}`, source: "suggestion", searchVolume: null, cpc: null, competition: null, difficulty: null, intent: null, monthlySearches: null },
    ];
  },
  async metrics() {
    return [];
  },
};
let calls = 0;
const fakeRanks: RankProvider = {
  id: "live-check-fake",
  name: "Live-check fake",
  supports: () => true,
  async check(q) {
    calls++;
    return { position: q.keyword.startsWith("how") ? null : 4, url: q.keyword.startsWith("how") ? null : `https://${q.domain}/x`, serpFeatures: [], checkedDepth: 100 };
  },
};

const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const db = createAdminClient();
const userId = randomUUID();
let orgId: string | null = null;
try {
  check("real keyword provider status", true, getKeywordProvider({ isDemoWebsite: false }) ? "CONNECTED" : "Provider Not Connected (expected without DATAFORSEO_* env)");
  check("real rank provider status", true, getRankProvider() ? "CONNECTED" : "Provider Not Connected");

  await pgc.query(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{}', now(), now())`,
    [userId, `kw-check-${userId.slice(0, 8)}@rankora.invalid`],
  );
  orgId = (await db.from("organizations").insert({ name: "KW check", slug: `kw-check-${userId.slice(0, 8)}`, created_by: userId }).select("id").single()).data!.id;
  await db.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const site = (await db.from("websites").insert({ organization_id: orgId, name: "kw", domain: "kwcheck.example", base_url: "https://kwcheck.example/", created_by: userId }).select("*").single()).data!;

  const none = await researchKeywords({ website: site, planId: "free", userId, seed: "tents", market: { countryCode: "US", languageCode: "en" }, provider: null });
  check("research without provider → not_connected", !none.ok && none.reason === "not_connected");

  const r = await researchKeywords({ website: site, planId: "free", userId, seed: "Hiking Tents", market: { countryCode: "US", languageCode: "en" }, provider: fakeKeywords });
  check("research stored", r.ok);
  const again = await researchKeywords({ website: site, planId: "free", userId, seed: "hiking tents", market: { countryCode: "US", languageCode: "en" }, provider: fakeKeywords });
  check("second identical search served from cache", again.ok && again.cached);
  const q = (await db.from("keyword_research_queries").select("results, provider").eq("id", r.ok ? r.queryId : "").single()).data!;
  const ideas = q.results as unknown as StoredIdea[];
  check("ideas classified & nulls preserved", ideas.length === 2 && ideas[1].type === "question" && ideas[1].searchVolume === null);
  const usage = (await db.from("usage_records").select("quantity").eq("organization_id", orgId).eq("metric", "keyword_lookups")).data ?? [];
  check("one lookup metered (cache hit not charged)", usage.length === 1);

  const ins = (
    await db
      .from("keywords")
      .insert(ideas.map((i) => ({ organization_id: orgId!, website_id: site.id, keyword: i.keyword, normalized_keyword: i.keyword, country_code: "US", language_code: "en", is_tracked: true })))
      .select("id, normalized_keyword")
  ).data!;
  await applyMetrics(new Map(ins.map((k) => [k.normalized_keyword, k.id])), ideas, q.provider);
  const saved = (await db.from("keywords").select("keyword, search_volume, metrics_source").eq("website_id", site.id).order("keyword")).data!;
  check("metrics applied with provider label", saved.some((k) => k.search_volume === 1000 && k.metrics_source === "live-check-fake") && saved.some((k) => k.search_volume === null));

  check("2 keywords due", (await dueKeywordCount(site.id)) === 2);
  const batch = await runRankBatch(site, { provider: fakeRanks });
  check("rank batch checked 2, none remaining", batch.checked === 2 && batch.remaining === 0, JSON.stringify(batch));
  const again2 = await runRankBatch(site, { provider: fakeRanks });
  check("no double charge on the same day", again2.checked === 0 && calls === 2);
  const tracked = (await db.from("keywords").select("keyword, current_position, best_position, last_checked_on, rank_source, rank_check_claimed_at").eq("website_id", site.id).order("keyword")).data!;
  check("trigger updated positions", tracked.some((k) => k.current_position === 4 && k.best_position === 4 && k.rank_source === "live-check-fake"), JSON.stringify(tracked.map((t) => [t.keyword, t.current_position])));
  check("claims released", tracked.every((k) => k.rank_check_claimed_at === null));

  const noProvider = await runRankBatch(site, { provider: null }).then(() => false, (e: Error) => /Provider|connected/i.test(e.message));
  check("rank batch refuses without provider", noProvider);
} finally {
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
  await pgc.query(`delete from auth.users where id = $1`, [userId]);
  const left = (await pgc.query(`select count(*)::int n from public.keywords where rank_source = 'live-check-fake' or metrics_source = 'live-check-fake'`)).rows[0].n;
  console.log(`\ncleanup done (leftover fake rows: ${left})`);
  await pgc.end();
}
