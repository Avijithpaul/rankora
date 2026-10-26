import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, createUser } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const VIEWER = "00000000-0000-4000-8000-0000000000a2";
const OUTSIDER = "00000000-0000-4000-8000-0000000000a3";

let db: PGlite;
let org: string;
let site: string;
let job: string;
let issue: string;

beforeAll(async () => {
  db = await createTestDb();
  for (const u of [OWNER, VIEWER, OUTSIDER]) await createUser(db, u);
  org = await asUser(db, OWNER, async (tx) => (await tx.query<{ id: string }>(`select public.create_organization('Audit Co', 'audit-co') as id`)).rows[0].id);
  site = await asUser(
    db,
    OWNER,
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          `insert into public.websites (organization_id, name, domain, base_url) values ($1, 'S', 's.example', 'https://s.example/') returning id`,
          [org],
        )
      ).rows[0].id,
  );
  await asService(db, async (tx) => {
    await tx.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')`, [org, VIEWER]);
    job = (await tx.query<{ id: string }>(`insert into public.crawl_jobs (organization_id, website_id, status) values ($1, $2, 'running') returning id`, [org, site])).rows[0].id;
    const p1 = (
      await tx.query<{ id: string }>(
        `insert into public.crawl_pages (organization_id, crawl_job_id, website_id, url, normalized_url, fetch_state) values ($1,$2,$3,'https://s.example/','https://s.example/','fetched') returning id`,
        [org, job, site],
      )
    ).rows[0].id;
    const p2 = (
      await tx.query<{ id: string }>(
        `insert into public.crawl_pages (organization_id, crawl_job_id, website_id, url, normalized_url, fetch_state) values ($1,$2,$3,'https://s.example/a','https://s.example/a','fetched') returning id`,
        [org, job, site],
      )
    ).rows[0].id;
    await tx.query(
      `insert into public.crawl_links (organization_id, crawl_job_id, source_page_id, target_url, is_internal) values
       ($1,$2,$3,'https://s.example/a',true), ($1,$2,$3,'https://s.example/',true), ($1,$2,$4,'https://s.example/a',true), ($1,$2,$3,'https://ext.example/',false)`,
      [org, job, p1, p2],
    );
    issue = (
      await tx.query<{ id: string }>(
        `insert into public.seo_issues (organization_id, website_id, rule_id, fingerprint, title, explanation, recommendation, severity)
         values ($1,$2,'page.title_missing','page.title_missing','t','e','r','critical') returning id`,
        [org, site],
      )
    ).rows[0].id;
  });
}, 60_000);

describe("crawler state migration", () => {
  it("only one active crawl per website", async () => {
    await expect(
      asService(db, (tx) => tx.query(`insert into public.crawl_jobs (organization_id, website_id, status) values ($1, $2, 'queued')`, [org, site])),
    ).rejects.toThrow(/duplicate key/);
  });

  it("crawl_compute_inbound counts distinct inbound links, ignoring self-links", async () => {
    await asService(db, (tx) => tx.query(`select public.crawl_compute_inbound($1)`, [job]));
    const r = await db.query<{ normalized_url: string; inbound_links_count: number; internal_links_count: number; external_links_count: number }>(
      `select normalized_url, inbound_links_count, internal_links_count, external_links_count from public.crawl_pages where crawl_job_id = $1 order by normalized_url`,
      [job],
    );
    expect(r.rows).toEqual([
      { normalized_url: "https://s.example/", inbound_links_count: 0, internal_links_count: 2, external_links_count: 1 },
      { normalized_url: "https://s.example/a", inbound_links_count: 1, internal_links_count: 1, external_links_count: 0 },
    ]);
  });

  it("clients cannot call crawl_compute_inbound or write crawl data", async () => {
    await expect(asUser(db, OWNER, (tx) => tx.query(`select public.crawl_compute_inbound($1)`, [job]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.crawl_jobs set status = 'completed' where id = $1`, [job]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`update public.crawl_pages set title = 'x' where crawl_job_id = $1`, [job])),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("issue status authorization", () => {
  it("members can ignore and reopen", async () => {
    const r = await asUser(db, OWNER, (tx) => tx.query(`update public.seo_issues set status = 'ignored' where id = $1`, [issue]));
    expect(r.affectedRows).toBe(1);
    await asUser(db, OWNER, (tx) => tx.query(`update public.seo_issues set status = 'open' where id = $1`, [issue]));
  });

  it("members cannot mark an issue fixed (only audits can)", async () => {
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.seo_issues set status = 'fixed' where id = $1`, [issue]))).rejects.toThrow(
      /only be ignored or reopened/,
    );
  });

  it("members cannot change other issue columns", async () => {
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.seo_issues set severity = 'opportunity' where id = $1`, [issue]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("viewers and outsiders cannot change issues", async () => {
    const v = await asUser(db, VIEWER, (tx) => tx.query(`update public.seo_issues set status = 'ignored' where id = $1`, [issue]));
    expect(v.affectedRows).toBe(0);
    const o = await asUser(db, OUTSIDER, (tx) => tx.query(`update public.seo_issues set status = 'ignored' where id = $1`, [issue]));
    expect(o.affectedRows).toBe(0);
  });

  it("the service role (audits) can mark issues fixed", async () => {
    const r = await asService(db, (tx) => tx.query(`update public.seo_issues set status = 'fixed', fixed_at = now() where id = $1`, [issue]));
    expect(r.affectedRows).toBe(1);
  });

  it("outsiders cannot see crawl data", async () => {
    for (const t of ["crawl_jobs", "crawl_pages", "crawl_links", "seo_issues"]) {
      const r = await asUser(db, OUTSIDER, (tx) => tx.query(`select 1 from public.${t}`));
      expect(r.rows, t).toHaveLength(0);
    }
  });
});
