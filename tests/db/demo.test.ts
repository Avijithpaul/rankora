import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { buildDemoPayload } from "@/lib/demo/generate";
import { asUser, createTestDb, createUser } from "./harness";

const DANA = "00000000-0000-4000-8000-0000000000d1";
const ERIN = "00000000-0000-4000-8000-0000000000e1";

let db: PGlite;
let result: { slug: string; website_id: string; created: boolean };

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, DANA, "Dana");
  await createUser(db, ERIN, "Erin");
  const payload = buildDemoPayload(new Date("2026-10-26T00:00:00Z"));
  result = await asUser(db, DANA, async (tx) => {
    const r = await tx.query<{ r: typeof result }>(`select public.create_demo_project($1::jsonb) as r`, [JSON.stringify(payload)]);
    return r.rows[0].r;
  });
}, 60_000);

describe("create_demo_project", () => {
  it("creates a demo org and demo website owned by the caller", async () => {
    expect(result.created).toBe(true);
    const rows = await asUser(db, DANA, (tx) =>
      tx.query<{ is_demo: boolean; site_demo: boolean; role: string }>(
        `select o.is_demo, w.is_demo as site_demo, m.role
         from public.organizations o
         join public.websites w on w.organization_id = o.id
         join public.organization_members m on m.organization_id = o.id and m.user_id = $1
         where o.slug = $2`,
        [DANA, result.slug],
      ),
    );
    expect(rows.rows[0]).toEqual({ is_demo: true, site_demo: true, role: "owner" });
  });

  it("labels every metric row as demo", async () => {
    const sources = await asUser(db, DANA, (tx) =>
      tx.query<{ s: string }>(
        `select distinct source as s from public.search_console_daily
         union select distinct source from public.search_console_queries
         union select distinct source from public.analytics_daily
         union select distinct source from public.keyword_rankings
         union select distinct metrics_source from public.keywords`,
      ),
    );
    expect(sources.rows.map((r) => r.s)).toEqual(["demo"]);
  });

  it("stores the score computed by the real engine and a check per rule", async () => {
    const r = await asUser(db, DANA, (tx) =>
      tx.query<{ score: string; checks: number }>(
        `select a.score::text, (select count(*)::int from public.seo_checks c where c.audit_id = a.id) as checks
         from public.seo_audits a where a.website_id = $1`,
        [result.website_id],
      ),
    );
    expect(Number(r.rows[0].score)).toBe(buildDemoPayload().audit.score);
    expect(r.rows[0].checks).toBe(33);
  });

  it("is idempotent per user", async () => {
    const again = await asUser(db, DANA, async (tx) => {
      const r = await tx.query<{ r: typeof result }>(`select public.create_demo_project('{"website":{},"audit":{}}'::jsonb) as r`);
      return r.rows[0].r;
    });
    expect(again).toMatchObject({ slug: result.slug, created: false });
  });

  it("another user cannot see someone else's demo project", async () => {
    const seen = await asUser(db, ERIN, (tx) => tx.query(`select id from public.websites`));
    expect(seen.rows).toHaveLength(0);
    const kw = await asUser(db, ERIN, (tx) => tx.query(`select id from public.keywords`));
    expect(kw.rows).toHaveLength(0);
  });

  it("real websites cannot be added to a demo organization", async () => {
    await expect(
      asUser(db, DANA, (tx) =>
        tx.query(
          `insert into public.websites (organization_id, name, domain, base_url)
           select id, 'Real', 'real.example', 'https://real.example/' from public.organizations where slug = $1`,
          [result.slug],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("rejects oversized payloads and anonymous callers", async () => {
    await createUser(db, "00000000-0000-4000-8000-0000000000f1", "Big");
    const huge = { website: { name: "x", domain: "x.example", base_url: "https://x.example/" }, audit: {}, keywords: Array(51).fill({}) };
    await expect(
      asUser(db, "00000000-0000-4000-8000-0000000000f1", (tx) => tx.query(`select public.create_demo_project($1::jsonb)`, [JSON.stringify(huge)])),
    ).rejects.toThrow(/too large/);
    await expect(asUser(db, null, (tx) => tx.query(`select public.create_demo_project('{}'::jsonb)`))).rejects.toThrow(/permission denied/);
  });

  it("the owner can remove the demo project; all its data cascades away", async () => {
    const del = await asUser(db, DANA, (tx) => tx.query(`delete from public.organizations where slug = $1 and is_demo`, [result.slug]));
    expect(del.affectedRows).toBe(1);
    const left = await tx(db);
    expect(left).toEqual({ sites: 0, kw: 0, ranks: 0, gsc: 0 });
  });
});

async function tx(d: PGlite) {
  const r = await d.query<{ sites: number; kw: number; ranks: number; gsc: number }>(
    `select (select count(*)::int from public.websites where is_demo) as sites,
            (select count(*)::int from public.keywords) as kw,
            (select count(*)::int from public.keyword_rankings) as ranks,
            (select count(*)::int from public.search_console_daily) as gsc`,
  );
  return r.rows[0];
}
