/**
 * End-to-end check of Phase 5 against the LIVE database and a real website:
 * temporary user/org/website → small audit → Content Optimizer on a real URL
 * and on a draft → Page Explorer as the signed-in user (RLS) → AI suggestion
 * path with a labelled fake provider (no AI API call) → cleanup.
 *
 *   npm run content:live-check -- https://books.toscrape.com/
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import { processJob, startAudit } from "../src/lib/audit/service.ts";
import { generateAiSuggestion, runContentAnalysis, type StoredContentResults } from "../src/lib/content/service.ts";
import type { AiProvider } from "../src/lib/ai/types.ts";

const target = new URL(process.argv[2] ?? "https://books.toscrape.com/");
const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const db = createAdminClient();
const userId = randomUUID();
let orgId: string | null = null;
let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};

/** Labelled test double: proves the storage/labelling path without calling a real model. */
const fakeProvider: AiProvider = {
  id: "test-double",
  model: "test-double",
  async generate(task) {
    if (task !== "titles") return { ok: false, reason: "unavailable", message: "only titles in the live check" };
    return { ok: true, model: "test-double", output: { suggestions: [{ text: "TEST DOUBLE — not an AI output", rationale: "live check" }] } } as never;
  },
};

try {
  await pgc.query(
    `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
     values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{"full_name":"Live check"}', now(), now())`,
    [userId, `live-check-${userId.slice(0, 8)}@rankora.invalid`],
  );
  const org = await db.from("organizations").insert({ name: "Live check", slug: `live-check-${userId.slice(0, 8)}`, created_by: userId }).select("*").single();
  if (org.error) throw org.error;
  orgId = org.data.id;
  await db.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const site = (
    await db
      .from("websites")
      .insert({ organization_id: orgId, name: target.hostname, domain: target.hostname.replace(/^www\./, ""), base_url: target.toString(), created_by: userId })
      .select("*")
      .single()
  ).data!;
  await db.from("website_settings").update({ max_pages: 10, max_depth: 2, crawl_delay_ms: 300, check_external_links: false }).eq("website_id", site.id);

  console.log("1. audit (10 pages)");
  const { jobId } = await startAudit({ website: site, planId: "free", userId, trigger: "manual" });
  for (let i = 0; i < 30; i++) {
    const s = await processJob(jobId, 15_000);
    if (s.status === "completed" || s.status === "failed") break;
  }
  const job = (await db.from("crawl_jobs").select("status").eq("id", jobId).single()).data!;
  check("audit completed", job.status === "completed", job.status);
  const pages = (await db.from("crawl_pages").select("normalized_url, title").eq("crawl_job_id", jobId).eq("status_code", 200).limit(20)).data ?? [];
  const page = pages.find((p) => p.normalized_url !== target.toString()) ?? pages[0];
  check("crawl produced pages", pages.length > 1, `${pages.length} pages`);

  await db.from("keywords").insert({ organization_id: orgId, website_id: site.id, keyword: "books", normalized_keyword: "books", country_code: "US", language_code: "en", target_url: page.normalized_url, created_by: userId });

  console.log("2. Content Optimizer — real URL");
  const r = await runContentAnalysis({ mode: "url", url: page.normalized_url, keyword: "books", terms: "price, in stock, travel books" }, { website: site, userId, reader: db });
  check("URL analysis stored", r.ok, r.ok ? r.id : r.message);
  if (r.ok) {
    const row = (await db.from("content_analyses").select("*").eq("id", r.id).single()).data!;
    const res = row.results as unknown as StoredContentResults;
    console.log(`     ${page.normalized_url}\n     score ${row.score} · ${row.word_count} words · title "${res.document.title}"`);
    for (const c of res.analysis.checks) console.log(`       ${c.status.padEnd(4)} ${c.label}: ${c.detail}`);
    check("checks evaluated", res.analysis.checks.length >= 20, `${res.analysis.checks.length} checks`);
    check("score within 0-100", Number(row.score) >= 0 && Number(row.score) <= 100);
    check("related terms carry sources", res.analysis.terms.every((t) => ["user", "saved_keyword", "search_console"].includes(t.source)), res.analysis.terms.map((t) => `${t.term}:${t.found}`).join(", "));
    check("recommendations are rule-based text", res.analysis.recommendations.length > 0);
    check("link candidates from crawl", res.linkCandidates.length > 0, `${res.linkCandidates.length} candidates, ${res.linkOpportunities.length} opportunities`);

    console.log("3. AI suggestion path");
    const none = await generateAiSuggestion(r.id, "titles", site, { reader: db, provider: null });
    check("no provider → not_connected (nothing invented)", !none.ok && none.reason === "not_connected");
    const ai = await generateAiSuggestion(r.id, "titles", site, { reader: db, provider: fakeProvider });
    const stored = (await db.from("content_analyses").select("ai_suggestions, ai_model").eq("id", r.id).single()).data!;
    const rec = (stored.ai_suggestions as Record<string, { label: string; provider: string }>)?.titles;
    check("suggestion stored and labelled", ai.ok && rec?.label === "AI suggestion" && rec.provider === "test-double");
    const other = await generateAiSuggestion(r.id, "titles", { ...site, id: randomUUID() }, { reader: db, provider: fakeProvider });
    check("analysis of another website is not found", !other.ok && other.reason === "not_found");
  }

  console.log("4. Content Optimizer — draft and rejected inputs");
  const draft = await runContentAnalysis(
    { mode: "draft", keyword: "travel books", title: "Travel Books Worth Reading", body: "# Travel books\n\nTravel books take you places. [See all](/catalogue/category/books/travel_2/index.html)\n\n## Classics\n- One\n- Two" },
    { website: site, userId, reader: db },
  );
  check("draft analysis stored", draft.ok);
  const off = await runContentAnalysis({ mode: "url", url: "https://example.com/", keyword: "x y" }, { website: site, userId, reader: db });
  check("off-site URL rejected", !off.ok && off.reason === "off_site", off.ok ? "" : off.message);
  const ssrf = await runContentAnalysis({ mode: "url", url: "http://127.0.0.1/", keyword: "x y" }, { website: site, userId, reader: db });
  check("private address rejected", !ssrf.ok && ssrf.reason === "invalid_url", ssrf.ok ? "" : ssrf.message);

  console.log("5. Page Explorer as the signed-in user (RLS)");
  const asUser = async <T,>(uid: string, sql: string, params: unknown[]) => {
    await pgc.query("begin");
    try {
      await pgc.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: uid, role: "authenticated" }), uid]);
      await pgc.query("set local role authenticated");
      return (await pgc.query(sql, params)).rows as T[];
    } finally {
      await pgc.query("rollback");
    }
  };
  const today = new Date().toISOString().slice(0, 10);
  const rows = await asUser<{ url: string; keywords: string; total_count: string }>(userId, `select url, keywords, total_count from public.page_explorer($1,$2,'2026-01-01',$3)`, [site.id, jobId, today]);
  check("explorer lists crawled pages", rows.length > 1, `${rows.length} rows`);
  check("keyword mapping joined", rows.some((x) => x.url === page.normalized_url && Number(x.keywords) === 1));
  const stranger = await asUser(randomUUID(), `select url from public.page_explorer($1,$2,'2026-01-01',$3)`, [site.id, jobId, today]);
  check("another user sees nothing", stranger.length === 0);
  const hist = await asUser<{ n: string }>(userId, `select count(*) n from public.content_analyses where website_id = $1`, [site.id]);
  check("history readable by member", Number(hist[0].n) === 2, hist[0].n);
} finally {
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
  await pgc.query(`delete from auth.users where id = $1`, [userId]);
  const left = (await pgc.query(`select count(*)::int n from public.organizations where slug like 'live-check-%'`)).rows[0].n;
  console.log(`\ncleanup done (leftover live-check orgs: ${left})`);
  await pgc.end();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll content checks passed.");
process.exit(failures ? 1 : 0);
