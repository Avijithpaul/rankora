/**
 * End-to-end check of Phase 7 reports against the LIVE database:
 *  - a Demo Project is created for a temporary user; all six report types are built from it and
 *    must be marked Demo Data, with totals equal to independent SQL sums
 *  - a real website gets a small real audit; its Site Audit report uses crawl data and reports
 *    "no data" for search/traffic instead of zeros
 *  - CSV/JSON exports, RLS for another user, cleanup
 *
 *   npm run reports:live-check -- https://books.toscrape.com/
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import { buildDemoPayload } from "../src/lib/demo/generate.ts";
import { processJob, startAudit } from "../src/lib/audit/service.ts";
import { createReport } from "../src/lib/reports/build.ts";
import { isUnavailable, REPORT_TYPES, resolvePeriod, type ReportSnapshot } from "../src/lib/reports/compose.ts";
import { csvExporter, jsonExporter } from "../src/lib/reports/export.ts";

const target = new URL(process.argv[2] ?? "https://books.toscrape.com/");
const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const db = createAdminClient();
const userId = randomUUID();
const strangerId = randomUUID();
const orgIds: string[] = [];
let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${extra ? ` — ${extra}` : ""}`);
};
const asUser = async <T,>(uid: string, sql: string, params: unknown[] = []) => {
  await pgc.query("begin");
  try {
    await pgc.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify({ sub: uid, role: "authenticated" }), uid]);
    await pgc.query("set local role authenticated");
    const r = (await pgc.query(sql, params)).rows as T[];
    await pgc.query("commit");
    return r;
  } catch (e) {
    await pgc.query("rollback");
    throw e;
  }
};
const snapshotOf = async (id: string) => (await db.from("reports").select("snapshot, is_demo, type").eq("id", id).single()).data!;

try {
  for (const id of [userId, strangerId]) {
    await pgc.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{"full_name":"Live check"}', now(), now())`,
      [id, `live-check-${id.slice(0, 8)}@rankora.invalid`],
    );
  }

  console.log("1. Demo Project reports");
  const created = (await asUser<{ r: { slug: string; website_id: string } }>(userId, `select public.create_demo_project($1::jsonb) as r`, [JSON.stringify(buildDemoPayload())]))[0].r;
  const demoSite = (await db.from("websites").select("*").eq("id", created.website_id).single()).data!;
  orgIds.push(demoSite.organization_id);
  const ids: Record<string, string> = {};
  for (const type of REPORT_TYPES) {
    const lastMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const period = resolvePeriod({ type, preset: "28d", month: lastMonth, compare: "previous" });
    if ("error" in period) throw new Error(period.error);
    ids[type] = await createReport({ type, website: demoSite, period, userId, reader: db });
  }
  const rows = await Promise.all(REPORT_TYPES.map((t) => snapshotOf(ids[t])));
  check("six report types stored", rows.length === 6 && rows.every((r, i) => r.type === REPORT_TYPES[i]));
  check("every demo report is flagged Demo Data", rows.every((r) => r.is_demo && (r.snapshot as unknown as ReportSnapshot).website.isDemo));

  const sp = (await snapshotOf(ids.search_performance)).snapshot as unknown as ReportSnapshot;
  if (sp.search && !isUnavailable(sp.search)) {
    const sql = (await pgc.query(`select coalesce(sum(clicks),0)::int c, coalesce(sum(impressions),0)::int i from public.search_console_daily where website_id = $1 and device = 'all' and country = 'all' and date between $2 and $3`, [demoSite.id, sp.period.from, sp.period.to])).rows[0];
    check("search totals equal an independent SQL sum", sp.search.totals.clicks.current === sql.c && sp.search.totals.impressions.current === sql.i, `${sp.search.totals.clicks.current} clicks / ${sql.c}`);
    check("search section labelled demo", sp.search.source === "demo");
    console.log(`     ${sp.period.from}–${sp.period.to}: clicks ${sp.search.totals.clicks.current} (prev ${sp.search.totals.clicks.previous}), top query “${sp.search.topQueries[0]?.key}”`);
  } else check("search section has data", false, isUnavailable(sp.search) ? sp.search.reason : "missing");

  const tr = (await snapshotOf(ids.traffic)).snapshot as unknown as ReportSnapshot;
  if (tr.traffic && !isUnavailable(tr.traffic)) {
    const sql = (await pgc.query(`select coalesce(sum(sessions),0)::int s from public.analytics_daily where website_id = $1 and channel = 'Organic Search' and device = 'all' and country = 'all' and date between $2 and $3`, [demoSite.id, tr.period.from, tr.period.to])).rows[0];
    check("organic sessions equal an independent SQL sum", tr.traffic.totals.sessions.current === sql.s, `${tr.traffic.totals.sessions.current} / ${sql.s}`);
  } else check("traffic section has data", false, isUnavailable(tr.traffic) ? tr.traffic.reason : "missing");

  const kr = (await snapshotOf(ids.keyword_ranking)).snapshot as unknown as ReportSnapshot;
  if (kr.rankings && !isUnavailable(kr.rankings)) {
    const total = kr.rankings.distribution.reduce((n, d) => n + d.current, 0);
    check("ranking distribution covers the tracked keywords", total <= kr.rankings.tracked && total > 0, `${total} of ${kr.rankings.tracked}; ${kr.rankings.improved.length} improved, ${kr.rankings.declined.length} declined`);
  } else check("ranking section has data", false, isUnavailable(kr.rankings) ? kr.rankings.reason : "missing");

  const mo = (await snapshotOf(ids.monthly)).snapshot as unknown as ReportSnapshot;
  check("monthly summary covers a calendar month with highlights", mo.period.from.endsWith("-01") && mo.highlights.length > 0, `${mo.period.from}–${mo.period.to}, ${mo.highlights.length} highlights`);
  for (const h of mo.highlights) console.log(`     • ${h}`);

  const csv = await csvExporter.render({ id: ids.overview, title: "Overview", snapshot: (await snapshotOf(ids.overview)).snapshot as unknown as ReportSnapshot });
  check("CSV export marked DEMO DATA", csv.filename.endsWith("-DEMO-DATA.csv") && String(csv.body).includes("(DEMO DATA)"));
  const json = await jsonExporter.render({ id: ids.overview, title: "Overview", snapshot: (await snapshotOf(ids.overview)).snapshot as unknown as ReportSnapshot });
  check("JSON export parses", JSON.parse(String(json.body)).website.isDemo === true);

  console.log("2. Real website — Site Audit report");
  const org = (await db.from("organizations").insert({ name: "Live check", slug: `live-check-${userId.slice(0, 8)}`, created_by: userId }).select("*").single()).data!;
  orgIds.push(org.id);
  await db.from("organization_members").insert({ organization_id: org.id, user_id: userId, role: "owner" });
  const site = (await db.from("websites").insert({ organization_id: org.id, name: target.hostname, domain: target.hostname.replace(/^www\./, ""), base_url: target.toString(), created_by: userId }).select("*").single()).data!;
  await db.from("website_settings").update({ max_pages: 8, max_depth: 2, crawl_delay_ms: 300, check_external_links: false }).eq("website_id", site.id);
  const { jobId } = await startAudit({ website: site, planId: "free", userId, trigger: "manual" });
  for (let i = 0; i < 30; i++) {
    const s = await processJob(jobId, 15_000);
    if (s.status === "completed" || s.status === "failed") break;
  }
  const period = resolvePeriod({ type: "overview", preset: "7d", compare: "previous" });
  if ("error" in period) throw new Error(period.error);
  const realId = await createReport({ type: "overview", website: site, period, userId, reader: db });
  const real = await snapshotOf(realId);
  const rs = real.snapshot as unknown as ReportSnapshot;
  const audit = (await db.from("seo_audits").select("score").eq("website_id", site.id).single()).data!;
  check("real report not flagged demo", real.is_demo === false && rs.website.isDemo === false);
  check("audit section uses the real crawl score", !isUnavailable(rs.audit) && rs.audit?.source === "crawl" && rs.audit.audit?.score === Number(audit.score), `score ${audit.score}`);
  check("search/traffic/rankings say 'no data' instead of zeros", isUnavailable(rs.search) && isUnavailable(rs.traffic) && isUnavailable(rs.rankings), isUnavailable(rs.search) ? rs.search.reason : "");

  console.log("3. Access control");
  check("owner reads the report (RLS)", (await asUser(userId, `select id from public.reports where id = $1`, [realId])).length === 1);
  check("another user cannot", (await asUser(strangerId, `select id from public.reports where id = $1`, [realId])).length === 0);
  try {
    await asUser(userId, `insert into public.reports (organization_id, website_id, type, title, date_from, date_to) values ($1,$2,'overview','x','2026-10-01','2026-10-02')`, [org.id, site.id]);
    check("clients cannot insert reports", false);
  } catch (e) {
    check("clients cannot insert reports", /permission denied/.test((e as Error).message));
  }
} finally {
  // also catch organizations created before an id was recorded
  const owned = (await pgc.query(`select distinct organization_id id from public.organization_members where user_id = any($1)`, [[userId, strangerId]])).rows.map((r) => r.id as string);
  for (const id of new Set([...orgIds, ...owned])) await db.from("organizations").delete().eq("id", id);
  await pgc.query(`delete from auth.users where id = any($1)`, [[userId, strangerId]]);
  const left = (await pgc.query(`select count(*)::int n from public.organizations where slug like 'live-check-%' or created_by = any($1)`, [[userId, strangerId]])).rows[0].n;
  console.log(`\ncleanup done (leftover orgs: ${left})`);
  await pgc.end();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll report checks passed.");
process.exit(failures ? 1 : 0);
