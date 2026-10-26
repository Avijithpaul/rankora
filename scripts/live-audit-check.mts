/**
 * End-to-end check of the real audit pipeline against the LIVE database:
 * creates a temporary user/org/website, runs startAudit + processJob ticks
 * until the audit completes, prints the result, then deletes everything.
 *
 *   npm run audit:live-check -- https://books.toscrape.com/ 15
 *
 * Only crawl sites you own or that explicitly allow crawling.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import { processJob, startAudit } from "../src/lib/audit/service.ts";

const target = process.argv[2] ?? "https://books.toscrape.com/";
const maxPages = Number(process.argv[3] ?? 15);
const url = new URL(target);

const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const db = createAdminClient();
const userId = randomUUID();
let orgId: string | null = null;

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
  const site = await db
    .from("websites")
    .insert({ organization_id: orgId, name: url.hostname, domain: url.hostname.replace(/^www\./, ""), base_url: url.toString(), created_by: userId })
    .select("*")
    .single();
  if (site.error) throw site.error;
  await db.from("website_settings").update({ max_pages: maxPages, max_depth: 3, crawl_delay_ms: 300, check_external_links: false }).eq("website_id", site.data.id);

  const { jobId } = await startAudit({ website: site.data, planId: "free", userId, trigger: "manual" });
  console.log(`job ${jobId} started for ${url}`);
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const s = await processJob(jobId, 15_000);
    console.log(`  tick ${i + 1}: ${s.status} / ${s.phase} — ${s.pagesCrawled} crawled, ${s.pagesDiscovered} discovered${s.error ? ` — error: ${s.error}` : ""}`);
    if (s.status === "completed" || s.status === "failed") break;
  }
  const job = (await db.from("crawl_jobs").select("*").eq("id", jobId).single()).data!;
  console.log(`finished in ${((Date.now() - t0) / 1000).toFixed(1)} s with status ${job.status}`);
  if (job.audit_id) {
    const audit = (await db.from("seo_audits").select("*").eq("id", job.audit_id).single()).data!;
    const checks = (await db.from("seo_checks").select("rule_id, result, severity, affected_count, total_count").eq("audit_id", audit.id)).data ?? [];
    const issues = (await db.from("seo_issues").select("rule_id, severity, affected_pages_count").eq("website_id", site.data.id)).data ?? [];
    const state = job.state as Record<string, { found?: boolean; urlCount?: number; skipped?: string }>;
    console.log(`\nSCORE ${audit.score} (v${audit.scoring_version}) · pages analyzed ${audit.pages_analyzed}`);
    console.log(`robots.txt found: ${state.robots?.found} · sitemap found: ${state.sitemap?.found} · pagespeed: ${state.pagespeed?.skipped ?? "measured"}`);
    console.log(`checks: ${checks.length} · critical ${audit.critical_count} · warning ${audit.warning_count} · opportunity ${audit.opportunity_count} · passed ${audit.passed_count}`);
    for (const c of checks.filter((c) => c.result === "failed")) console.log(`  ✗ [${c.severity}] ${c.rule_id}: ${c.affected_count}/${c.total_count}`);
    console.log(`issues stored: ${issues.length}`);
  }
} finally {
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
  await pgc.query(`delete from auth.users where id = $1`, [userId]);
  const left = (await pgc.query(`select count(*)::int n from public.organizations where slug like 'live-check-%'`)).rows[0].n;
  console.log(`\ncleanup done (leftover live-check orgs: ${left})`);
  await pgc.end();
}
