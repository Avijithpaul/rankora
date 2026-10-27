/**
 * End-to-end check of Phase 6 against the LIVE database:
 *  - competitor homepage + page comparison against real websites (RankoraBot, robots.txt respected)
 *  - competitor positions captured from the same SERP during a rank batch (labelled test-double SERP provider)
 *  - backlink sync with a labelled test-double provider, aggregation as the signed-in user, stale-row removal
 *  - tasks from an issue: one open task per issue, assignee/issue guards, task_stats, RLS
 * Everything is created in a temporary organization and deleted afterwards.
 *
 *   npm run phase6:live-check -- https://books.toscrape.com/ quotes.toscrape.com
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { createAdminClient } from "../src/lib/supabase/admin.ts";
import { captureHomepageComparison, comparePages, refreshDomainKeywords, type PageSide } from "../src/lib/competitors/service.ts";
import { compareSnapshots, type TechnicalSnapshot } from "../src/lib/competitors/compare.ts";
import { syncBacklinks } from "../src/lib/backlinks/service.ts";
import { runRankBatch } from "../src/lib/keywords/service.ts";
import { parseSerp } from "../src/lib/providers/dataforseo.ts";
import type { BacklinkProvider, RankProvider } from "../src/lib/providers/types.ts";

const target = new URL(process.argv[2] ?? "https://books.toscrape.com/");
const rival = process.argv[3] ?? "quotes.toscrape.com";
const pgc = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgc.connect();
const db = createAdminClient();
const userId = randomUUID();
const strangerId = randomUUID();
let orgId: string | null = null;
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

/** Test double: a fixed SERP run through the real DataForSEO parser. Not real ranking data. */
const fakeSerp: RankProvider = {
  id: "test-double",
  name: "Test double",
  supports: () => true,
  async check(q) {
    const items = [
      { type: "organic", rank_group: 1, domain: rival, url: `https://${rival}/` },
      { type: "organic", rank_group: 4, domain: q.domain, url: `https://${q.domain}/` },
    ];
    return parseSerp([{ items, item_types: ["organic"] }], q.domain, 100, q.competitors ?? []);
  },
};
let backlinkRound = 0;
const fakeBacklinks: BacklinkProvider = {
  id: "test-double",
  name: "Test double",
  async summary() {
    return { backlinks: 3, referringDomains: 2, referringMainDomains: 2, referringIps: 2, brokenBacklinks: 0, rank: 12, spamScore: 1, firstSeen: "2026-01-01" };
  },
  async backlinks(t, opts) {
    const link = (from: string, anchor: string, extra = {}) => ({
      sourceUrl: `https://${from}/p`, sourceDomain: from, targetUrl: `https://${t}/`, anchor, rel: "follow" as const, linkType: "anchor" as const,
      domainRank: 30, firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-20T00:00:00Z", isNew: false, isLost: false, ...extra,
    });
    if (opts?.status === "lost") return { total: 1, items: backlinkRound === 0 ? [link("gone.example", "old", { isLost: true })] : [] };
    const live = [link("a.example", "books"), link("b.example", "", { isNew: true })];
    return { total: live.length, items: backlinkRound === 0 ? live : live.slice(0, 1) };
  },
};

try {
  for (const id of [userId, strangerId]) {
    await pgc.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '{"full_name":"Live check"}', now(), now())`,
      [id, `live-check-${id.slice(0, 8)}@rankora.invalid`],
    );
  }
  const org = (await db.from("organizations").insert({ name: "Live check", slug: `live-check-${userId.slice(0, 8)}`, created_by: userId }).select("*").single()).data!;
  orgId = org.id;
  await db.from("organization_members").insert({ organization_id: orgId, user_id: userId, role: "owner" });
  const site = (await db.from("websites").insert({ organization_id: orgId, name: target.hostname, domain: target.hostname.replace(/^www\./, ""), base_url: target.toString(), created_by: userId }).select("*").single()).data!;
  const comp = (await asUser<{ id: string }>(userId, `insert into public.competitors (organization_id, website_id, domain, name) values ($1,$2,$3,'Rival') returning id`, [orgId, site.id, rival]))[0];
  const competitor = (await db.from("competitors").select("*").eq("id", comp.id).single()).data!;

  console.log("1. SEO audit comparison — real homepages");
  const h = await captureHomepageComparison({ website: site, competitor, userId });
  const snap = (await db.from("competitor_snapshots").select("data").eq("id", h.ok ? h.id! : "").single()).data!;
  const d = snap.data as unknown as { own: TechnicalSnapshot; theirs: TechnicalSnapshot };
  const checks = compareSnapshots(d.own, d.theirs);
  for (const c of checks) console.log(`     ${c.label.padEnd(38)} you: ${c.own.padEnd(7)} ${c.ownValue.padEnd(18)} them: ${c.theirs.padEnd(7)} ${c.theirValue}`);
  check("both homepages fetched", d.own.ok && d.theirs.ok, `${d.own.status} / ${d.theirs.status}`);
  check("same 15 checks on both sides", checks.length === 15);

  console.log("2. Content comparison — real pages");
  const p = await comparePages({ website: site, competitor, keyword: "books", ownUrl: target.toString(), theirUrl: `https://${rival}/`, userId });
  const pc = (await db.from("competitor_snapshots").select("data").eq("id", p.ok ? p.id! : "").single()).data!.data as unknown as { own: PageSide; theirs: PageSide };
  check("both pages analyzed", pc.own.score !== null && pc.theirs.score !== null, `you ${pc.own.score} (${pc.own.words} words) vs them ${pc.theirs.score} (${pc.theirs.words} words)`);
  const off = await comparePages({ website: site, competitor, keyword: "books", ownUrl: `https://${rival}/`, theirUrl: "http://169.254.169.254/", userId });
  check("off-site and metadata URLs refused", !off.ok, off.ok ? "" : off.message);

  console.log("3. Overlap & gaps without a provider");
  const kwSnap = await refreshDomainKeywords({ website: site, competitor, userId, planId: "free" });
  check("no provider → not_connected, nothing stored", !kwSnap.ok && kwSnap.reason === "not_connected" && ((await db.from("domain_keyword_snapshots").select("id").eq("website_id", site.id)).data ?? []).length === 0);

  console.log("4. Competitor rankings from the same SERP");
  const kw = (await asUser<{ id: string }>(userId, `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, is_tracked) values ($1,$2,'books online','books online','US','en',true) returning id`, [orgId, site.id]))[0];
  const batch = await runRankBatch(site, { provider: fakeSerp, max: 5 });
  check("rank batch ran", batch.checked === 1, JSON.stringify(batch));
  const cr = await asUser<{ position: number }>(userId, `select position from public.competitor_rankings where keyword_id = $1`, [kw.id]);
  check("competitor position stored from the same SERP", cr[0]?.position === 1);
  check("stranger cannot read it", (await asUser(strangerId, `select 1 from public.competitor_rankings where keyword_id = $1`, [kw.id])).length === 0);

  console.log("5. Backlinks (test-double provider)");
  const none = await syncBacklinks({ website: site, userId, planId: "free", provider: null });
  check("no provider → not_connected", !none.ok && none.reason === "not_connected");
  const s1 = await syncBacklinks({ website: site, userId, planId: "free", provider: fakeBacklinks });
  check("first sync stores live + lost links", s1.ok && s1.stored === 3, JSON.stringify(s1));
  const rd = await asUser<{ domain: string; live: number }>(userId, `select domain, live from public.backlink_referring_domains($1)`, [site.id]);
  check("referring domains aggregated as the user", rd.length === 3, rd.map((r) => `${r.domain}:${r.live}`).join(", "));
  backlinkRound = 1;
  const s2 = await syncBacklinks({ website: site, userId, planId: "free", provider: fakeBacklinks });
  const left = (await db.from("backlinks").select("source_domain").eq("website_id", site.id)).data ?? [];
  check("second sync removes links the provider no longer returns", s2.ok && left.length === 1 && left[0].source_domain === "a.example", left.map((l) => l.source_domain).join(","));
  await expectDenied("client cannot insert backlinks", () => asUser(userId, `insert into public.backlinks (organization_id, website_id, source_url, source_domain, target_url, provider) values ($1,$2,'https://f.example','f.example','https://x/','fake')`, [orgId, site.id]));

  console.log("6. Tasks");
  const issue = (await db.from("seo_issues").insert({ organization_id: orgId, website_id: site.id, rule_id: "page.title_missing", fingerprint: "page.title_missing", title: "Missing title", explanation: "e", recommendation: "Add a title", severity: "critical" }).select("id").single()).data!;
  const t = (await asUser<{ id: string }>(userId, `insert into public.seo_tasks (organization_id, website_id, issue_id, title, priority, source, due_date) values ($1,$2,$3,'Missing title','critical','issue', current_date - 1) returning id`, [orgId, site.id, issue.id]))[0];
  check("task created from issue", Boolean(t.id));
  await expectDenied("second open task for the same issue rejected", () => asUser(userId, `insert into public.seo_tasks (organization_id, website_id, issue_id, title, source) values ($1,$2,$3,'dup','issue')`, [orgId, site.id, issue.id]));
  await expectDenied("assignee outside the organization rejected", () => asUser(userId, `update public.seo_tasks set assigned_to = $2 where id = $1`, [t.id, strangerId]));
  const stats = (await asUser<Record<string, string>>(userId, `select * from public.task_stats($1,$2)`, [orgId, site.id]))[0];
  check("task_stats counts the overdue task", Number(stats.todo) === 1 && Number(stats.overdue) === 1, JSON.stringify(stats));
  await asUser(userId, `update public.seo_tasks set status = 'completed' where id = $1`, [t.id]);
  const done = (await db.from("seo_tasks").select("completed_at").eq("id", t.id).single()).data!;
  check("completed_at set by the database", Boolean(done.completed_at));
  check("stranger sees no tasks", (await asUser(strangerId, `select 1 from public.seo_tasks where website_id = $1`, [site.id])).length === 0);
} finally {
  if (orgId) await db.from("organizations").delete().eq("id", orgId);
  await pgc.query(`delete from auth.users where id = any($1)`, [[userId, strangerId]]);
  const left = (await pgc.query(`select count(*)::int n from public.organizations where slug like 'live-check-%'`)).rows[0].n;
  console.log(`\ncleanup done (leftover live-check orgs: ${left})`);
  await pgc.end();
}
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll Phase 6 checks passed.");
process.exit(failures ? 1 : 0);

async function expectDenied(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    check(label, false, "was allowed");
  } catch (e) {
    check(label, true, (e as Error).message.slice(0, 80));
  }
}
