import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, createUser } from "./harness";

const ALICE = "00000000-0000-4000-8000-00000000000a";
const BOB = "00000000-0000-4000-8000-00000000000b";
const CAROL = "00000000-0000-4000-8000-00000000000c";

let db: PGlite;
let aliceOrg: string;
let bobOrg: string;
let aliceSite: string;

async function rows<T = Record<string, unknown>>(p: Promise<{ rows: unknown[] }>) {
  return (await p).rows as T[];
}

beforeAll(async () => {
  db = await createTestDb();
  await createUser(db, ALICE, "Alice");
  await createUser(db, BOB, "Bob");
  await createUser(db, CAROL, "Carol");

  aliceOrg = await asUser(db, ALICE, async (tx) => {
    const r = await rows<{ id: string }>(tx.query(`select public.create_organization('Alice Co', 'alice-co') as id`));
    return r[0].id;
  });
  bobOrg = await asUser(db, BOB, async (tx) => {
    const r = await rows<{ id: string }>(tx.query(`select public.create_organization('Bob Co', 'bob-co') as id`));
    return r[0].id;
  });
  aliceSite = await asUser(db, ALICE, async (tx) => {
    const r = await rows<{ id: string }>(
      tx.query(
        `insert into public.websites (organization_id, name, domain, base_url)
         values ($1, 'Alice site', 'alice.example', 'https://alice.example/') returning id`,
        [aliceOrg],
      ),
    );
    return r[0].id;
  });
}, 60_000);

describe("migrations", () => {
  it("creates profile on signup via trigger", async () => {
    const r = await rows<{ full_name: string }>(db.query(`select full_name from public.profiles where id = $1`, [ALICE]));
    expect(r[0].full_name).toBe("Alice");
  });

  it("create_organization makes the caller owner with a free subscription", async () => {
    const m = await rows<{ role: string }>(
      db.query(`select role from public.organization_members where organization_id = $1 and user_id = $2`, [aliceOrg, ALICE]),
    );
    expect(m[0].role).toBe("owner");
    const s = await rows<{ plan_id: string }>(db.query(`select plan_id from public.subscriptions where organization_id = $1`, [aliceOrg]));
    expect(s[0].plan_id).toBe("free");
  });

  it("creates default website settings", async () => {
    const r = await rows(db.query(`select max_pages from public.website_settings where website_id = $1`, [aliceSite]));
    expect(r).toHaveLength(1);
  });
});

describe("tenant isolation (RLS)", () => {
  it("a user only sees organizations they belong to", async () => {
    const orgs = await asUser(db, ALICE, (tx) => rows<{ id: string }>(tx.query(`select id from public.organizations`)));
    expect(orgs.map((o) => o.id)).toEqual([aliceOrg]);
  });

  it("another tenant sees zero rows in EVERY tenant-scoped table", async () => {
    await asUser(db, ALICE, (tx) =>
      tx.query(`insert into public.seo_tasks (organization_id, website_id, title) values ($1, $2, 'Fix titles')`, [aliceOrg, aliceSite]),
    );
    const tables = (
      await db.query<{ table_name: string }>(
        `select c.table_name from information_schema.columns c
         join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema
         where c.table_schema = 'public' and c.column_name = 'organization_id' and t.table_type = 'BASE TABLE'`,
      )
    ).rows.map((r) => r.table_name);
    expect(tables.length).toBeGreaterThan(25);
    for (const t of tables) {
      const visible = await asUser(db, BOB, async (tx) => {
        try {
          const r = await tx.query<{ n: number }>(`select count(*)::int as n from public.${t} where organization_id = $1`, [aliceOrg]);
          return r.rows[0].n;
        } catch (e) {
          if (/permission denied/.test((e as Error).message)) return 0; // table not readable by clients at all
          throw e;
        }
      });
      expect(visible, t).toBe(0);
    }
  });

  it("another tenant cannot read websites", async () => {
    const sites = await asUser(db, BOB, (tx) => rows(tx.query(`select id from public.websites`)));
    expect(sites).toHaveLength(0);
  });

  it("another tenant cannot insert into a foreign organization", async () => {
    await expect(
      asUser(db, BOB, (tx) =>
        tx.query(
          `insert into public.websites (organization_id, name, domain, base_url)
           values ($1, 'Hijack', 'hijack.example', 'https://hijack.example/')`,
          [aliceOrg],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("composite FK blocks attaching data to another org's website", async () => {
    // Bob writes a keyword in *his* org but points at Alice's website.
    await expect(
      asUser(db, BOB, (tx) =>
        tx.query(
          `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code)
           values ($1, $2, 'x', 'x', 'US', 'en')`,
          [bobOrg, aliceSite],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it("anon sees nothing but the plan catalog", async () => {
    const plans = await asUser(db, null, (tx) => rows(tx.query(`select id from public.plans`)));
    expect(plans.length).toBeGreaterThanOrEqual(3);
    await expect(asUser(db, null, (tx) => tx.query(`select id from public.websites`))).rejects.toThrow(/permission denied/);
  });

  it("users cannot create demo websites or change is_demo", async () => {
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.query(
          `insert into public.websites (organization_id, name, domain, base_url, is_demo)
           values ($1, 'Fake demo', 'demo.example', 'https://demo.example/', true)`,
          [aliceOrg],
        ),
      ),
    ).rejects.toThrow(/row-level security|Website limit reached/);
    await expect(
      asUser(db, ALICE, (tx) => tx.query(`update public.websites set is_demo = true where id = $1`, [aliceSite])),
    ).rejects.toThrow(/permission denied/);
  });

  it("crawl results are read-only for clients", async () => {
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.query(`insert into public.crawl_jobs (organization_id, website_id) values ($1, $2)`, [aliceOrg, aliceSite]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("oauth token columns are never readable by clients", async () => {
    await asService(db, (tx) =>
      tx.query(
        `insert into public.oauth_connections (organization_id, provider, access_token_encrypted) values ($1, 'google', 'secret')`,
        [aliceOrg],
      ),
    );
    const ok = await asUser(db, ALICE, (tx) => rows(tx.query(`select id, provider from public.oauth_connections`)));
    expect(ok).toHaveLength(1);
    await expect(
      asUser(db, ALICE, (tx) => tx.query(`select access_token_encrypted from public.oauth_connections`)),
    ).rejects.toThrow(/permission denied/);
  });
});

describe("roles", () => {
  beforeAll(async () => {
    await asService(db, (tx) =>
      tx.query(`insert into public.organization_members (organization_id, user_id, role) values ($1, $2, 'viewer')`, [
        aliceOrg,
        CAROL,
      ]),
    );
  });

  it("viewers can read but not write", async () => {
    const sites = await asUser(db, CAROL, (tx) => rows(tx.query(`select id from public.websites`)));
    expect(sites).toHaveLength(1);
    await expect(
      asUser(db, CAROL, (tx) =>
        tx.query(
          `insert into public.seo_tasks (organization_id, website_id, title) values ($1, $2, 'Nope')`,
          [aliceOrg, aliceSite],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("viewers cannot change roles (RLS filters the update)", async () => {
    const res = await asUser(db, CAROL, (tx) =>
      tx.query(`update public.organization_members set role = 'owner' where user_id = $1`, [CAROL]),
    );
    expect(res.affectedRows).toBe(0);
  });

  it("admins cannot grant the owner role", async () => {
    await asService(db, (tx) =>
      tx.query(`update public.organization_members set role = 'admin' where user_id = $1 and organization_id = $2`, [
        CAROL,
        aliceOrg,
      ]),
    );
    await expect(
      asUser(db, CAROL, (tx) =>
        tx.query(`update public.organization_members set role = 'owner' where user_id = $1`, [CAROL]),
      ),
    ).rejects.toThrow(/Only owners/);
    await asService(db, (tx) =>
      tx.query(`update public.organization_members set role = 'viewer' where user_id = $1 and organization_id = $2`, [
        CAROL,
        aliceOrg,
      ]),
    );
  });

  it("the last owner cannot be removed or demoted", async () => {
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.query(`update public.organization_members set role = 'admin' where user_id = $1 and organization_id = $2`, [
          ALICE,
          aliceOrg,
        ]),
      ),
    ).rejects.toThrow(/at least one owner/);
  });

  it("task assignee must be an org member", async () => {
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.query(
          `insert into public.seo_tasks (organization_id, website_id, title, assigned_to) values ($1, $2, 'T', $3)`,
          [aliceOrg, aliceSite, BOB],
        ),
      ),
    ).rejects.toThrow(/not a member/);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit, then blocks", async () => {
    const results = await asUser(db, ALICE, async (tx) => {
      const out: boolean[] = [];
      for (let i = 0; i < 4; i++) {
        const r = await rows<{ ok: boolean }>(tx.query(`select public.rate_limit_hit('test.bucket', 3, 3600) as ok`));
        out.push(r[0].ok);
      }
      return out;
    });
    expect(results).toEqual([true, true, true, false]);
  });

  it("anon cannot spend rate-limit budget", async () => {
    await expect(asUser(db, null, (tx) => tx.query(`select public.rate_limit_hit('x', 1, 60)`))).rejects.toThrow(
      /permission denied/,
    );
  });
});
