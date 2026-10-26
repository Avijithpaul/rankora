import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { buildDemoPayload } from "@/lib/demo/generate";
import { asService, asUser, createTestDb, createUser } from "./harness";

const A = "00000000-0000-4000-8000-0000000000b1";
const B = "00000000-0000-4000-8000-0000000000b2";

let db: PGlite;
let orgA: string;
let siteA: string;
let kw: string;
let orgB: string;
let groupB: string;

async function one<T>(p: Promise<{ rows: unknown[] }>) {
  return (await p).rows[0] as T;
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, A);
  await createUser(db, B);
  orgA = await asUser(db, A, async (tx) => (await one<{ id: string }>(tx.query(`select public.create_organization('KW A', 'kw-a') as id`))).id);
  orgB = await asUser(db, B, async (tx) => (await one<{ id: string }>(tx.query(`select public.create_organization('KW B', 'kw-b') as id`))).id);
  siteA = await asUser(db, A, async (tx) =>
    (await one<{ id: string }>(tx.query(`insert into public.websites (organization_id, name, domain, base_url) values ($1,'A','a.example','https://a.example/') returning id`, [orgA]))).id,
  );
  const siteB = await asUser(db, B, async (tx) =>
    (await one<{ id: string }>(tx.query(`insert into public.websites (organization_id, name, domain, base_url) values ($1,'B','b.example','https://b.example/') returning id`, [orgB]))).id,
  );
  kw = await asUser(db, A, async (tx) =>
    (
      await one<{ id: string }>(
        tx.query(
          `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, is_tracked)
           values ($1,$2,'hiking boots','hiking boots','US','en',true) returning id`,
          [orgA, siteA],
        ),
      )
    ).id,
  );
  groupB = await asUser(db, B, async (tx) =>
    (await one<{ id: string }>(tx.query(`insert into public.keyword_groups (organization_id, website_id, name) values ($1,$2,'B group') returning id`, [orgB, siteB]))).id,
  );
}, 60_000);

const positions = () =>
  db.query<{ current_position: number | null; previous_position: number | null; best_position: number | null; last_checked_on: string; current_url: string | null }>(
    `select current_position, previous_position, best_position, last_checked_on::text, current_url from public.keywords where id = $1`,
    [kw],
  );

describe("position trigger", () => {
  it("derives current / previous / best from snapshots (any insert order)", async () => {
    await asService(db, (tx) =>
      tx.query(
        `insert into public.keyword_rankings (organization_id, keyword_id, checked_on, position, ranking_url, source) values
         ($1,$2,'2026-10-03',7,'https://a.example/c','test'),
         ($1,$2,'2026-10-01',12,'https://a.example/a','test'),
         ($1,$2,'2026-10-02',4,'https://a.example/b','test')`,
        [orgA, kw],
      ),
    );
    expect((await positions()).rows[0]).toEqual({ current_position: 7, previous_position: 4, best_position: 4, last_checked_on: "2026-10-03", current_url: "https://a.example/c" });
  });

  it("handles 'not ranking' snapshots and deletions", async () => {
    await asService(db, (tx) => tx.query(`insert into public.keyword_rankings (organization_id, keyword_id, checked_on, position, source) values ($1,$2,'2026-10-04',null,'test')`, [orgA, kw]));
    expect((await positions()).rows[0]).toMatchObject({ current_position: null, previous_position: 7, best_position: 4 });
    await asService(db, (tx) => tx.query(`delete from public.keyword_rankings where keyword_id = $1 and checked_on = '2026-10-04'`, [kw]));
    expect((await positions()).rows[0]).toMatchObject({ current_position: 7, previous_position: 4 });
  });

  it("backfilled the Demo Project's denormalized positions", async () => {
    await asUser(db, B, (tx) => tx.query(`select public.create_demo_project($1::jsonb)`, [JSON.stringify(buildDemoPayload(new Date("2026-10-26T00:00:00Z")))]));
    const r = await db.query<{ n: number }>(`select count(*)::int n from public.keywords k join public.websites w on w.id = k.website_id where w.is_demo and k.last_checked_on is not null`);
    expect(r.rows[0].n).toBe(10);
  });
});

describe("provider data is server-only", () => {
  it("clients cannot write metrics or positions", async () => {
    await expect(asUser(db, A, (tx) => tx.query(`update public.keywords set search_volume = 99999 where id = $1`, [kw]))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`update public.keywords set current_position = 1 where id = $1`, [kw]))).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, A, (tx) =>
        tx.query(
          `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, search_volume)
           values ($1,$2,'fake','fake','US','en',123456)`,
          [orgA, siteA],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.keyword_rankings (organization_id, keyword_id, checked_on, position, source) values ($1,$2,'2026-10-10',1,'me')`, [orgA, kw])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.keyword_research_queries (organization_id, seed, country_code, language_code, provider) values ($1,'x','US','en','dataforseo')`, [orgA])),
    ).rejects.toThrow(/permission denied/);
  });

  it("clients can manage tracking, target URL and notes", async () => {
    const r = await asUser(db, A, (tx) => tx.query(`update public.keywords set is_tracked = false, target_url = 'https://a.example/boots', notes = 'n' where id = $1`, [kw]));
    expect(r.affectedRows).toBe(1);
  });

  it("demo keywords are read-only for clients", async () => {
    const demoKw = await asUser(db, B, async (tx) => (await tx.query<{ id: string }>(`select k.id from public.keywords k join public.websites w on w.id = k.website_id where w.is_demo limit 1`)).rows[0].id);
    const upd = await asUser(db, B, (tx) => tx.query(`update public.keywords set notes = 'x' where id = $1`, [demoKw]));
    expect(upd.affectedRows).toBe(0);
    const del = await asUser(db, B, (tx) => tx.query(`delete from public.keywords where id = $1`, [demoKw]));
    expect(del.affectedRows).toBe(0);
  });
});

describe("tenant isolation for keywords", () => {
  it("other tenants see none of the keywords or rankings", async () => {
    const k = await asUser(db, B, (tx) => tx.query(`select id from public.keywords where organization_id = $1`, [orgA]));
    expect(k.rows).toHaveLength(0);
    const r = await asUser(db, B, (tx) => tx.query(`select 1 from public.keyword_rankings where organization_id = $1`, [orgA]));
    expect(r.rows).toHaveLength(0);
  });

  it("a keyword cannot be added to another organization's group", async () => {
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.keyword_group_members (group_id, keyword_id, organization_id) values ($1,$2,$3)`, [groupB, kw, orgA])),
    ).rejects.toThrow(/foreign key|row-level security/);
    await expect(
      asUser(db, B, (tx) => tx.query(`insert into public.keyword_group_members (group_id, keyword_id, organization_id) values ($1,$2,$3)`, [groupB, kw, orgB])),
    ).rejects.toThrow(/foreign key|row-level security/);
  });
});
