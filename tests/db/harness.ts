/**
 * Loads the real Supabase migrations into an in-process Postgres (PGlite) with a
 * minimal stub of Supabase's `auth` schema and roles, so RLS policies, grants,
 * triggers and RPCs can be tested without Docker or a cloud project.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (
    id uuid primary key,
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb
  );
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated, service_role;
`;

export async function createTestDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    try {
      await db.exec(sql);
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return db;
}

export async function createUser(db: PGlite, id: string, fullName = "Test User") {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    id,
    `${id.slice(0, 8)}@example.test`,
    JSON.stringify({ full_name: fullName }),
  ]);
}

/** Run queries as a signed-in Supabase user (role authenticated + JWT sub). */
export async function asUser<T>(db: PGlite, userId: string | null, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  await db.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ""]);
  await db.exec(userId ? `set role authenticated` : `set role anon`);
  try {
    return await fn(db);
  } finally {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
  }
}

/** Run queries as the service role (bypasses RLS like the server admin client). */
export async function asService<T>(db: PGlite, fn: (tx: PGlite) => Promise<T>): Promise<T> {
  await db.exec(`set role service_role`);
  try {
    return await fn(db);
  } finally {
    await db.exec(`reset role`);
  }
}
