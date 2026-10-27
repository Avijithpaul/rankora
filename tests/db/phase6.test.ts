import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, createUser } from "./harness";

const A = "00000000-0000-4000-8000-0000000000f1";
const B = "00000000-0000-4000-8000-0000000000f2";
const V = "00000000-0000-4000-8000-0000000000f3"; // viewer in org A
let db: PGlite;
let orgA: string;
let siteA: string;
let siteA2: string;
let comp: string;
let kw: string;
let issue: string;
let issueOther: string;

beforeAll(async () => {
  db = await createTestDb();
  for (const u of [A, B, V]) await createUser(db, u);
  orgA = await asUser(db, A, async (tx) => (await tx.query<{ id: string }>(`select public.create_organization('P A', 'p-a') as id`)).rows[0].id);
  await asUser(db, B, (tx) => tx.query(`select public.create_organization('P B', 'p-b')`));
  await asService(db, (tx) => tx.query(`insert into public.organization_members (organization_id, user_id, role) values ($1,$2,'viewer')`, [orgA, V]));
  const site = (domain: string) =>
    asUser(db, A, async (tx) => (await tx.query<{ id: string }>(`insert into public.websites (organization_id, name, domain, base_url) values ($1,$2,$2,'https://' || $2 || '/') returning id`, [orgA, domain])).rows[0].id);
  siteA = await site("a.example");
  siteA2 = await site("a2.example");
  comp = await asUser(db, A, async (tx) => (await tx.query<{ id: string }>(`insert into public.competitors (organization_id, website_id, domain) values ($1,$2,'rival.example') returning id`, [orgA, siteA])).rows[0].id);
  kw = await asUser(db, A, async (tx) =>
    (await tx.query<{ id: string }>(`insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code) values ($1,$2,'boots','boots','US','en') returning id`, [orgA, siteA])).rows[0].id,
  );
  await asService(db, async (tx) => {
    const mk = async (site: string, fp: string) =>
      (
        await tx.query<{ id: string }>(
          `insert into public.seo_issues (organization_id, website_id, rule_id, fingerprint, title, explanation, recommendation, severity) values ($1,$2,$3,$3,'t','e','r','critical') returning id`,
          [orgA, site, fp],
        )
      ).rows[0].id;
    issue = await mk(siteA, "page.title_missing");
    issueOther = await mk(siteA2, "page.h1_missing");
    await tx.query(
      `insert into public.backlinks (organization_id, website_id, source_url, source_domain, target_url, anchor_text, rel, provider, is_lost, first_seen_at) values
       ($1,$2,'https://x.example/1','x.example','https://a.example/','boots','follow','dataforseo',false,'2026-10-01'),
       ($1,$2,'https://x.example/2','x.example','https://a.example/b','','nofollow','dataforseo',false,'2026-10-02'),
       ($1,$2,'https://y.example/1','y.example','https://a.example/','boots','follow','dataforseo',true,'2026-09-01')`,
      [orgA, siteA],
    );
  });
}, 60_000);

describe("competitor data", () => {
  it("rankings and snapshots are server-written and tenant-scoped", async () => {
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.competitor_rankings (organization_id, competitor_id, keyword_id, checked_on, position, source) values ($1,$2,$3,current_date,3,'x')`, [orgA, comp, kw])),
    ).rejects.toThrow(/permission denied/);
    await asService(db, (tx) => tx.query(`insert into public.competitor_rankings (organization_id, competitor_id, keyword_id, checked_on, position, source) values ($1,$2,$3,current_date,3,'dataforseo')`, [orgA, comp, kw]));
    expect((await asUser(db, A, (tx) => tx.query(`select position from public.competitor_rankings`))).rows).toEqual([{ position: 3 }]);
    expect((await asUser(db, B, (tx) => tx.query(`select position from public.competitor_rankings`))).rows).toHaveLength(0);
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.domain_keyword_snapshots (organization_id, website_id, domain, country_code, language_code, provider) values ($1,$2,'a.example','US','en','x')`, [orgA, siteA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("competitors: domain is immutable for clients, viewers cannot add, deleting cascades", async () => {
    await expect(asUser(db, A, (tx) => tx.query(`update public.competitors set domain = 'evil.example' where id = $1`, [comp]))).rejects.toThrow(/permission denied/);
    await asUser(db, A, (tx) => tx.query(`update public.competitors set name = 'Rival' where id = $1`, [comp]));
    await expect(
      asUser(db, V, (tx) => tx.query(`insert into public.competitors (organization_id, website_id, domain) values ($1,$2,'v.example')`, [orgA, siteA])),
    ).rejects.toThrow(/row-level security/);
    const tmp = await asUser(db, A, async (tx) => (await tx.query<{ id: string }>(`insert into public.competitors (organization_id, website_id, domain) values ($1,$2,'tmp.example') returning id`, [orgA, siteA])).rows[0].id);
    await asService(db, (tx) => tx.query(`insert into public.competitor_rankings (organization_id, competitor_id, keyword_id, checked_on, source) values ($1,$2,$3,current_date,'dataforseo')`, [orgA, tmp, kw]));
    await asUser(db, A, (tx) => tx.query(`delete from public.competitors where id = $1`, [tmp]));
    expect((await asService(db, (tx) => tx.query(`select 1 from public.competitor_rankings where competitor_id = $1`, [tmp]))).rows).toHaveLength(0);
  });
});

describe("backlinks", () => {
  it("aggregates referring domains and live anchors; clients cannot write", async () => {
    const rd = await asUser(db, A, (tx) => tx.query<{ domain: string; backlinks: number; follow: number; live: number }>(`select domain, backlinks, follow, live from public.backlink_referring_domains($1)`, [siteA]));
    expect(rd.rows).toEqual([
      { domain: "x.example", backlinks: 2, follow: 1, live: 2 },
      { domain: "y.example", backlinks: 1, follow: 1, live: 0 },
    ]);
    const an = await asUser(db, A, (tx) => tx.query<{ anchor: string; backlinks: number }>(`select anchor, backlinks from public.backlink_anchors($1)`, [siteA]));
    expect(an.rows).toEqual([
      { anchor: "(no anchor text)", backlinks: 1 },
      { anchor: "boots", backlinks: 1 },
    ]);
    expect((await asUser(db, B, (tx) => tx.query(`select * from public.backlink_referring_domains($1)`, [siteA]))).rows).toHaveLength(0);
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.backlinks (organization_id, website_id, source_url, source_domain, target_url, provider) values ($1,$2,'https://f.example','f.example','https://a.example/','fake')`, [orgA, siteA])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`insert into public.backlink_syncs (organization_id, website_id, provider, status) values ($1,$2,'x','completed')`, [orgA, siteA]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe("seo_tasks", () => {
  const insertTask = (user: string, site: string, issueId: string | null, extra = "") =>
    asUser(db, user, async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into public.seo_tasks (organization_id, website_id, issue_id, title, source${extra ? ", due_date" : ""}) values ($1,$2,$3,'Fix title',${issueId ? "'issue'" : "'manual'"}${extra ? `, ${extra}` : ""}) returning id`,
          [orgA, site, issueId],
        )
      ).rows[0].id,
    );

  it("allows one open task per issue and rejects issues from another website", async () => {
    const t = await insertTask(A, siteA, issue);
    await expect(insertTask(A, siteA, issue)).rejects.toThrow(/seo_tasks_open_issue_idx/);
    await expect(insertTask(A, siteA, issueOther)).rejects.toThrow(/does not belong to this website/);
    await asUser(db, A, (tx) => tx.query(`update public.seo_tasks set status = 'completed' where id = $1`, [t]));
    const again = await insertTask(A, siteA, issue); // previous one is closed
    expect(again).toBeTruthy();
  });

  it("sets completed_at server-side and protects system columns", async () => {
    const t = await insertTask(A, siteA, null);
    await asUser(db, A, (tx) => tx.query(`update public.seo_tasks set status = 'completed' where id = $1`, [t]));
    const r = await asUser(db, A, (tx) => tx.query<{ completed_at: string | null }>(`select completed_at from public.seo_tasks where id = $1`, [t]));
    expect(r.rows[0].completed_at).not.toBeNull();
    await expect(asUser(db, A, (tx) => tx.query(`update public.seo_tasks set completed_at = null where id = $1`, [t]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`update public.seo_tasks set website_id = $2 where id = $1`, [t, siteA2]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`update public.seo_tasks set assigned_to = $2 where id = $1`, [t, B]))).rejects.toThrow(/not a member/);
    await asUser(db, A, (tx) => tx.query(`update public.seo_tasks set assigned_to = $2 where id = $1`, [t, V]));
  });

  it("viewers read but cannot change tasks; other tenants see nothing", async () => {
    expect((await asUser(db, V, (tx) => tx.query(`select id from public.seo_tasks`))).rows.length).toBeGreaterThan(0);
    expect((await asUser(db, V, (tx) => tx.query(`update public.seo_tasks set status = 'ignored'`))).affectedRows).toBe(0);
    expect((await asUser(db, B, (tx) => tx.query(`select id from public.seo_tasks`))).rows).toHaveLength(0);
  });

  it("task_stats counts by status, overdue and due soon", async () => {
    await insertTask(A, siteA2, null, "current_date - 3");
    await insertTask(A, siteA2, null, "current_date + 2");
    const all = await asUser(db, A, (tx) => tx.query<Record<string, number>>(`select * from public.task_stats($1)`, [orgA]));
    expect(all.rows[0]).toMatchObject({ completed: 2, overdue: 1, due_7d: 1, completed_30d: 2 });
    const one = await asUser(db, A, (tx) => tx.query<Record<string, number>>(`select * from public.task_stats($1,$2)`, [orgA, siteA2]));
    expect(one.rows[0]).toMatchObject({ todo: 2, completed: 0 });
    const other = await asUser(db, B, (tx) => tx.query<Record<string, number>>(`select * from public.task_stats($1)`, [orgA]));
    expect(other.rows[0]).toMatchObject({ todo: 0, completed: 0 });
  });
});
