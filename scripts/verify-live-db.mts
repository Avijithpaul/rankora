/**
 * Verifies the LIVE Supabase database (DATABASE_URL) after migrations:
 *  - every public table has RLS enabled
 *  - two throw-away users: user B sees none of user A's rows in any tenant table
 *  - viewer/anon restrictions, demo project RPC
 * Everything runs inside one transaction that is ROLLED BACK — nothing persists.
 *
 *   npm run db:verify
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildDemoPayload } from "../src/lib/demo/generate.ts";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

async function as(userId: string | null, fn: () => Promise<void>) {
  await client.query("reset role");
  const claims = userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : JSON.stringify({ role: "anon" });
  await client.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [claims, userId ?? ""]);
  await client.query(userId ? "set local role authenticated" : "set local role anon");
  try {
    await fn();
  } finally {
    await client.query("reset role");
  }
}

async function expectError(fn: () => Promise<unknown>, pattern: RegExp) {
  await client.query("savepoint sp");
  try {
    await fn();
    await client.query("release savepoint sp");
    return false;
  } catch (e) {
    await client.query("rollback to savepoint sp");
    return pattern.test((e as Error).message);
  }
}

try {
  await client.query("begin");

  // ---- structure ------------------------------------------------------------
  const tables = (
    await client.query<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' order by 1`,
    )
  ).rows;
  check("public tables created", tables.length === 41, `${tables.length} tables`);
  const noRls = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
  check("RLS enabled on every public table", noRls.length === 0, noRls.join(", "));
  const policies = (await client.query<{ n: number }>(`select count(*)::int n from pg_policies where schemaname = 'public'`)).rows[0].n;
  check("RLS policies present", policies > 60, `${policies} policies`);
  const plans = (await client.query<{ n: number }>(`select count(*)::int n from public.plans`)).rows[0].n;
  check("plan catalog seeded", plans === 3);

  // ---- throw-away users -------------------------------------------------------
  const A = randomUUID();
  const B = randomUUID();
  for (const [id, name] of [
    [A, "Verify A"],
    [B, "Verify B"],
  ]) {
    await client.query(
      `insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, $3, now(), now())`,
      [id, `verify-${id.slice(0, 8)}@rankora.invalid`, JSON.stringify({ full_name: name })],
    );
  }
  const profile = (await client.query(`select full_name from public.profiles where id = $1`, [A])).rows[0];
  check("profile auto-created on signup", profile?.full_name === "Verify A");

  let orgA = "";
  let siteA = "";
  await as(A, async () => {
    orgA = (await client.query(`select public.create_organization('Verify Org', $1) as id`, [`verify-${A.slice(0, 8)}`])).rows[0].id;
    siteA = (
      await client.query(
        `insert into public.websites (organization_id, name, domain, base_url) values ($1, 'Verify', 'verify.example', 'https://verify.example/') returning id`,
        [orgA],
      )
    ).rows[0].id;
    await client.query(`insert into public.seo_tasks (organization_id, website_id, title) values ($1, $2, 'Task')`, [orgA, siteA]);
    await client.query(
      `insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code) values ($1, $2, 'k', 'k', 'US', 'en')`,
      [orgA, siteA],
    );
    const own = (await client.query(`select count(*)::int n from public.websites`)).rows[0].n;
    check("owner sees own website", own === 1);
  });

  // ---- isolation across every tenant table ----------------------------------------
  const tenantTables = (
    await client.query<{ table_name: string }>(
      `select c.table_name from information_schema.columns c join information_schema.tables t
         on t.table_name = c.table_name and t.table_schema = c.table_schema
       where c.table_schema = 'public' and c.column_name = 'organization_id' and t.table_type = 'BASE TABLE'`,
    )
  ).rows.map((r) => r.table_name);
  const leaks: string[] = [];
  await as(B, async () => {
    for (const t of tenantTables) {
      await client.query("savepoint s");
      try {
        const n = (await client.query(`select count(*)::int n from public.${t} where organization_id = $1`, [orgA])).rows[0].n;
        if (n > 0) leaks.push(`${t}(${n})`);
        await client.query("release savepoint s");
      } catch {
        await client.query("rollback to savepoint s"); // permission denied = not readable at all
      }
    }
    const insertForeign = await expectError(
      () => client.query(`insert into public.websites (organization_id, name, domain, base_url) values ($1, 'x', 'x.example', 'https://x.example/')`, [orgA]),
      /row-level security/,
    );
    check("user B cannot add a website to user A's organization", insertForeign);
    const upd = await client.query(`update public.websites set name = 'hacked' where id = $1`, [siteA]);
    check("user B cannot modify user A's website", upd.rowCount === 0);
    const del = await client.query(`delete from public.websites where id = $1`, [siteA]);
    check("user B cannot delete user A's website", del.rowCount === 0);
  });
  check(`user B sees 0 rows of user A in all ${tenantTables.length} tenant tables`, leaks.length === 0, leaks.join(", "));

  // ---- anon -------------------------------------------------------------------------
  await as(null, async () => {
    const p = (await client.query(`select count(*)::int n from public.plans`)).rows[0].n;
    check("anonymous visitors can read the public plan catalog", p === 3);
    check(
      "anonymous visitors cannot read websites",
      await expectError(() => client.query(`select id from public.websites`), /permission denied/),
    );
  });

  // ---- demo project ------------------------------------------------------------------
  await as(B, async () => {
    const r = (await client.query(`select public.create_demo_project($1::jsonb) as r`, [JSON.stringify(buildDemoPayload())])).rows[0].r;
    check("demo project created for user B", r.created === true);
    const src = (
      await client.query<{ s: string }>(
        `select distinct source s from public.search_console_daily union select distinct source from public.keyword_rankings`,
      )
    ).rows.map((x) => x.s);
    check("all demo metrics labelled 'demo'", src.length === 1 && src[0] === "demo");
  });
  await as(A, async () => {
    const n = (await client.query(`select count(*)::int n from public.organizations where is_demo`)).rows[0].n;
    check("user A cannot see user B's demo project", n === 0);
  });
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}

console.log(failures === 0 ? "\nAll live checks passed (transaction rolled back, nothing persisted)." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
