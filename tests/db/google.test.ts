import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, createUser } from "./harness";

const A = "00000000-0000-4000-8000-0000000000d7";
const B = "00000000-0000-4000-8000-0000000000d8";
let db: PGlite;
let orgA: string;
let siteA: string;

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, A);
  await createUser(db, B);
  orgA = await asUser(db, A, async (tx) => (await tx.query<{ id: string }>(`select public.create_organization('G A', 'g-a') as id`)).rows[0].id);
  await asUser(db, B, (tx) => tx.query(`select public.create_organization('G B', 'g-b')`));
  siteA = await asUser(db, A, async (tx) =>
    (await tx.query<{ id: string }>(`insert into public.websites (organization_id, name, domain, base_url) values ($1,'A','a.example','https://a.example/') returning id`, [orgA])).rows[0].id,
  );
  await asService(db, async (tx) => {
    await tx.query(
      `insert into public.search_console_daily (organization_id, website_id, date, device, country, source, clicks, impressions, ctr, position) values
       ($1,$2,'2026-10-01','all','all','gsc',10,100,0.1,5), ($1,$2,'2026-10-01','mobile','all','gsc',6,60,0.1,4), ($1,$2,'2026-10-01','desktop','all','gsc',4,40,0.1,6.5),
       ($1,$2,'2026-10-01','all','usa','gsc',7,70,0.1,5)`,
      [orgA, siteA],
    );
    await tx.query(
      `insert into public.search_console_queries (organization_id, website_id, date, query, source, clicks, impressions, ctr, position) values
       ($1,$2,'2026-10-01','boots','gsc',5,50,0.1,2), ($1,$2,'2026-10-02','boots','gsc',5,150,0.03,6), ($1,$2,'2026-10-01','tents','gsc',1,10,0.1,9)`,
      [orgA, siteA],
    );
    await tx.query(
      `insert into public.analytics_daily (organization_id, website_id, date, channel, device, country, source, users, new_users, sessions, engaged_sessions, page_views) values
       ($1,$2,'2026-10-01','Organic Search','all','all','ga4',8,3,10,6,20), ($1,$2,'2026-10-02','Organic Search','all','all','ga4',2,1,5,2,7), ($1,$2,'2026-10-01','Direct','all','all','ga4',1,1,1,0,1)`,
      [orgA, siteA],
    );
    await tx.query(`insert into public.oauth_connections (organization_id, provider, provider_account_email, access_token_encrypted, refresh_token_encrypted) values ($1,'google','owner@example.com','v1.ct','v1.rt')`, [orgA]);
    await tx.query(`insert into public.oauth_states (state_hash, user_id, organization_id, website_id, provider, expires_at) values ('h', $1, $2, $3, 'google', now() + interval '10 minutes')`, [A, orgA, siteA]);
  });
}, 60_000);

describe("gsc_breakdown / ga_breakdown", () => {
  it("aggregates queries with impression-weighted position", async () => {
    const r = await asUser(db, A, (tx) => tx.query<{ key: string; clicks: string; impressions: string; avg_position: string }>(`select * from public.gsc_breakdown($1,'query','2026-10-01','2026-10-31')`, [siteA]));
    expect(r.rows[0]).toMatchObject({ key: "boots", clicks: 10, impressions: 200, avg_position: "5.00" });
    expect(r.rows.map((x) => x.key)).toEqual(["boots", "tents"]);
  });

  it("separates device / country rows from totals", async () => {
    const dev = await asUser(db, A, (tx) => tx.query<{ key: string }>(`select key from public.gsc_breakdown($1,'device','2026-10-01','2026-10-31')`, [siteA]));
    expect(dev.rows.map((x) => x.key)).toEqual(["mobile", "desktop"]);
    const c = await asUser(db, A, (tx) => tx.query<{ key: string }>(`select key from public.gsc_breakdown($1,'country','2026-10-01','2026-10-31')`, [siteA]));
    expect(c.rows.map((x) => x.key)).toEqual(["usa"]);
  });

  it("aggregates GA4 channels", async () => {
    const r = await asUser(db, A, (tx) => tx.query<{ key: string; sessions: string }>(`select key, sessions from public.ga_breakdown($1,'channel','2026-10-01','2026-10-31')`, [siteA]));
    expect(r.rows).toEqual([{ key: "Organic Search", sessions: 15 }, { key: "Direct", sessions: 1 }]);
  });

  it("respects RLS: another tenant aggregates nothing; anon cannot call", async () => {
    const r = await asUser(db, B, (tx) => tx.query(`select * from public.gsc_breakdown($1,'query','2026-10-01','2026-10-31')`, [siteA]));
    expect(r.rows).toHaveLength(0);
    const g = await asUser(db, B, (tx) => tx.query(`select * from public.ga_breakdown($1,'channel','2026-10-01','2026-10-31')`, [siteA]));
    expect(g.rows).toHaveLength(0);
    await expect(asUser(db, null, (tx) => tx.query(`select * from public.gsc_breakdown($1,'query','2026-10-01','2026-10-31')`, [siteA]))).rejects.toThrow(/permission denied/);
  });
});

describe("OAuth data protection", () => {
  it("tokens and states are never readable by clients", async () => {
    await expect(asUser(db, A, (tx) => tx.query(`select refresh_token_encrypted from public.oauth_connections`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`select access_token_encrypted from public.oauth_connections`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`select * from public.oauth_states`))).rejects.toThrow(/permission denied/);
    const ok = await asUser(db, A, (tx) => tx.query(`select id, provider_account_email, status, provider_account_id from public.oauth_connections`));
    expect(ok.rows).toHaveLength(1);
  });

  it("other tenants cannot see connections; clients cannot write integrations or synced data", async () => {
    expect((await asUser(db, B, (tx) => tx.query(`select id from public.oauth_connections`))).rows).toHaveLength(0);
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.integrations (organization_id, website_id, provider, status) values ($1,$2,'google_search_console','connected')`, [orgA, siteA])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, A, (tx) => tx.query(`insert into public.search_console_daily (organization_id, website_id, date, source, clicks) values ($1,$2,'2026-10-05','gsc',999)`, [orgA, siteA])),
    ).rejects.toThrow(/permission denied/);
    await expect(asUser(db, A, (tx) => tx.query(`update public.analytics_daily set users = 1`))).rejects.toThrow(/permission denied/);
  });
});

describe("rank_distribution and previous_checked_on", () => {
  it("tracks the previous snapshot date and aggregates buckets per day", async () => {
    const kw = await asUser(db, A, async (tx) =>
      (await tx.query<{ id: string }>(`insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, is_tracked) values ($1,$2,'k','k','US','en',true) returning id`, [orgA, siteA])).rows[0].id,
    );
    await asService(db, (tx) =>
      tx.query(`insert into public.keyword_rankings (organization_id, keyword_id, checked_on, position, source) values ($1,$2,'2026-10-01',12,'t'), ($1,$2,'2026-10-02',3,'t')`, [orgA, kw]),
    );
    const k = await db.query<{ previous_checked_on: string; previous_position: number }>(`select previous_checked_on::text, previous_position from public.keywords where id = $1`, [kw]);
    expect(k.rows[0]).toEqual({ previous_checked_on: "2026-10-01", previous_position: 12 });
    const d = await asUser(db, A, (tx) => tx.query<{ date: string; top3: number; top20: number }>(`select date::text, top3, top20 from public.rank_distribution($1,'2026-09-01')`, [siteA]));
    expect(d.rows).toEqual([
      { date: "2026-10-01", top3: 0, top20: 1 },
      { date: "2026-10-02", top3: 1, top20: 0 },
    ]);
    expect((await asUser(db, B, (tx) => tx.query(`select * from public.rank_distribution($1,'2026-09-01')`, [siteA]))).rows).toHaveLength(0);
  });
});
