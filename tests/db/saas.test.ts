import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { asService, asUser, createTestDb, createUser } from "./harness";

const OWNER = "00000000-0000-4000-8000-0000000000a1";
const OWNER2 = "00000000-0000-4000-8000-0000000000a2";
const ADMIN = "00000000-0000-4000-8000-0000000000a3";
const MEMBER = "00000000-0000-4000-8000-0000000000a4";
const OUTSIDER = "00000000-0000-4000-8000-0000000000a5";
let db: PGlite;
let org: string;
let site: string;

const addMember = (user: string, role: string) => asService(db, (tx) => tx.query(`insert into public.organization_members (organization_id, user_id, role) values ($1,$2,$3)`, [org, user, role]));
const setPlan = (plan: string, status = "active") => asService(db, (tx) => tx.query(`update public.subscriptions set plan_id = $2, status = $3 where organization_id = $1`, [org, plan, status]));
const planOf = async () => (await db.query<{ plan_id: string }>(`select plan_id from public.organizations where id = $1`, [org])).rows[0].plan_id;

beforeAll(async () => {
  db = await createTestDb();
  for (const u of [OWNER, OWNER2, ADMIN, MEMBER, OUTSIDER]) await createUser(db, u);
  org = await asUser(db, OWNER, async (tx) => (await tx.query<{ id: string }>(`select public.create_organization('S A', 's-a') as id`)).rows[0].id);
  await asUser(db, OUTSIDER, (tx) => tx.query(`select public.create_organization('S B', 's-b')`));
  site = await asUser(db, OWNER, async (tx) => (await tx.query<{ id: string }>(`insert into public.websites (organization_id, name, domain, base_url) values ($1,'A','a.example','https://www.a.example/') returning id`, [org])).rows[0].id);
}, 60_000);

describe("plan catalog and subscriptions", () => {
  it("has Free, Starter, Pro and Agency with every limit key", async () => {
    const r = await asUser(db, null, (tx) => tx.query<{ id: string; limits: Record<string, number> }>(`select id, limits from public.plans order by sort_order`));
    expect(r.rows.map((p) => p.id)).toEqual(["free", "starter", "pro", "agency"]);
    for (const p of r.rows) {
      expect(Object.keys(p.limits).sort()).toEqual(
        ["ai_credits_per_month", "backlink_lookups_per_month", "crawl_pages_per_audit", "crawl_pages_per_month", "keyword_lookups_per_month", "members", "rank_checks_per_month", "reports_per_month", "tracked_keywords", "websites"].sort(),
      );
    }
  });

  it("the subscription drives organizations.plan_id; canceled falls back to Free", async () => {
    await setPlan("pro");
    expect(await planOf()).toBe("pro");
    await setPlan("pro", "past_due");
    expect(await planOf()).toBe("pro");
    await setPlan("agency", "canceled");
    expect(await planOf()).toBe("free");
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.subscriptions set plan_id = 'agency'`))).rejects.toThrow(/permission denied/);
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.organizations set plan_id = 'agency' where id = $1`, [org]))).rejects.toThrow(/permission denied/);
  });

  it("billing events are invisible to clients", async () => {
    await asService(db, (tx) => tx.query(`insert into public.billing_events (provider, event_id, type) values ('stripe','evt_1','ignored')`));
    await expect(asService(db, (tx) => tx.query(`insert into public.billing_events (provider, event_id, type) values ('stripe','evt_1','ignored')`))).rejects.toThrow(/duplicate key/);
    await expect(asUser(db, OWNER, (tx) => tx.query(`select * from public.billing_events`))).rejects.toThrow(/permission denied/);
  });
});

describe("team members", () => {
  it("clients cannot add members directly; the plan's member limit is enforced by the database", async () => {
    await expect(asUser(db, OWNER, (tx) => tx.query(`insert into public.organization_members (organization_id, user_id, role) values ($1,$2,'member')`, [org, MEMBER]))).rejects.toThrow(/permission denied/);
    await setPlan("free");
    await addMember(ADMIN, "admin"); // 2 of 2 on Free
    await expect(addMember(MEMBER, "member")).rejects.toThrow(/Member limit reached/);
    await setPlan("pro");
    await addMember(MEMBER, "member");
    await addMember(OWNER2, "owner");
  });

  it("admins cannot remove or demote owners; owners can; anyone can leave", async () => {
    await expect(asUser(db, ADMIN, (tx) => tx.query(`delete from public.organization_members where organization_id = $1 and user_id = $2`, [org, OWNER2]))).rejects.toThrow(/Only owners can remove an owner/);
    await expect(asUser(db, ADMIN, (tx) => tx.query(`update public.organization_members set role = 'member' where organization_id = $1 and user_id = $2`, [org, OWNER2]))).rejects.toThrow(/owner/);
    expect((await asUser(db, MEMBER, (tx) => tx.query(`delete from public.organization_members where organization_id = $1 and user_id = $2`, [org, ADMIN]))).affectedRows).toBe(0);
    expect((await asUser(db, OWNER, (tx) => tx.query(`delete from public.organization_members where organization_id = $1 and user_id = $2`, [org, OWNER2]))).affectedRows).toBe(1);
    expect((await asUser(db, MEMBER, (tx) => tx.query(`delete from public.organization_members where organization_id = $1 and user_id = $2`, [org, MEMBER]))).affectedRows).toBe(1);
    await expect(asUser(db, OWNER, (tx) => tx.query(`delete from public.organization_members where organization_id = $1 and user_id = $2`, [org, OWNER]))).rejects.toThrow(/at least one owner/);
  });

  it("invitations: admins see them without the token hash; members and outsiders see nothing", async () => {
    await addMember(MEMBER, "member");
    await asService(db, (tx) =>
      tx.query(`insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at) values ($1,'new@example.com','member',repeat('a',64), now() + interval '7 days')`, [org]),
    );
    expect((await asUser(db, ADMIN, (tx) => tx.query(`select email from public.organization_invitations`))).rows).toEqual([{ email: "new@example.com" }]);
    await expect(asUser(db, ADMIN, (tx) => tx.query(`select token_hash from public.organization_invitations`))).rejects.toThrow(/permission denied/);
    expect((await asUser(db, MEMBER, (tx) => tx.query(`select id from public.organization_invitations`))).rows).toHaveLength(0);
    expect((await asUser(db, OUTSIDER, (tx) => tx.query(`select id from public.organization_invitations`))).rows).toHaveLength(0);
    await expect(asService(db, (tx) => tx.query(`insert into public.organization_invitations (organization_id, email, role, token_hash, expires_at) values ($1,'x@example.com','owner',repeat('b',64), now())`, [org]))).rejects.toThrow(/check/);
    await expect(asUser(db, OWNER, (tx) => tx.query(`select public.org_member_by_email($1, 'a@b.c')`, [org]))).rejects.toThrow(/permission denied/);
  });
});

describe("limits enforced in the database", () => {
  it("websites: plan limit for members, URL must match the domain", async () => {
    await setPlan("free");
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`insert into public.websites (organization_id, name, domain, base_url) values ($1,'B','b.example','https://b.example/')`, [org])),
    ).rejects.toThrow(/Website limit reached/);
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.websites set base_url = 'https://victim.example/' where id = $1`, [site]))).rejects.toThrow(/must be on its domain/);
    await asUser(db, OWNER, (tx) => tx.query(`update public.websites set base_url = 'https://a.example/blog' where id = $1`, [site]));
  });

  it("tracked keywords: plan limit", async () => {
    await asService(db, (tx) =>
      tx.query(
        `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, is_tracked)
         select $1, $2, 'k' || g, 'k' || g, 'US', 'en', true from generate_series(1, 25) g`,
        [org, site],
      ),
    );
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code, is_tracked) values ($1,$2,'k26','k26','US','en',true)`, [org, site])),
    ).rejects.toThrow(/Tracked keyword limit/);
    await asUser(db, OWNER, (tx) => tx.query(`insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code) values ($1,$2,'k27','k27','US','en')`, [org, site]));
    await expect(asUser(db, OWNER, (tx) => tx.query(`update public.keywords set is_tracked = true where keyword = 'k27'`))).rejects.toThrow(/Tracked keyword limit/);
  });

  it("competitors: 10 per website", async () => {
    await asService(db, (tx) => tx.query(`insert into public.competitors (organization_id, website_id, domain) select $1, $2, 'c' || g || '.example' from generate_series(1, 10) g`, [org, site]));
    await expect(asUser(db, OWNER, (tx) => tx.query(`insert into public.competitors (organization_id, website_id, domain) values ($1,$2,'c11.example')`, [org, site]))).rejects.toThrow(/Up to 10 competitors/);
  });

  it("URL fields accept only http(s) or paths", async () => {
    await expect(
      asUser(db, OWNER, (tx) => tx.query(`insert into public.seo_tasks (organization_id, website_id, title, page_url) values ($1,$2,'x','javascript:alert(1)')`, [org, site])),
    ).rejects.toThrow(/seo_tasks_page_url_scheme/);
    await asUser(db, OWNER, (tx) => tx.query(`insert into public.seo_tasks (organization_id, website_id, title, page_url) values ($1,$2,'x','/pricing')`, [org, site]));
  });
});

describe("usage_summary", () => {
  it("sums this month's usage per metric for members only", async () => {
    await asService(db, (tx) =>
      tx.query(
        `insert into public.usage_records (organization_id, metric, quantity, occurred_at) values
         ($1,'crawl_pages',40,now()), ($1,'crawl_pages',10,now()), ($1,'ai_credits',3,now()), ($1,'crawl_pages',999, now() - interval '2 months')`,
        [org],
      ),
    );
    const r = await asUser(db, OWNER, (tx) => tx.query<{ metric: string; used: number }>(`select metric, used from public.usage_summary($1) order by metric`, [org]));
    expect(r.rows).toEqual([
      { metric: "ai_credits", used: 3 },
      { metric: "crawl_pages", used: 50 },
    ]);
    expect((await asUser(db, OUTSIDER, (tx) => tx.query(`select * from public.usage_summary($1)`, [org]))).rows).toHaveLength(0);
  });
});
