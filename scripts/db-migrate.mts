/**
 * Applies supabase/migrations/*.sql to the database in DATABASE_URL, in filename
 * order, each in its own transaction. Applied versions are recorded in
 * supabase_migrations.schema_migrations (the same table the Supabase CLI uses),
 * so this script and `supabase db push` stay compatible.
 *
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --status  list applied / pending only
 *
 * DATABASE_URL: Supabase → Connect → Session pooler URI (with your DB password).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (Supabase → Connect → Session pooler).");
  process.exit(1);
}
const statusOnly = process.argv.includes("--status");

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(`
    create schema if not exists supabase_migrations;
    create table if not exists supabase_migrations.schema_migrations (
      version text primary key,
      statements text[],
      name text
    );`);
  const applied = new Set(
    (await client.query<{ version: string }>(`select version from supabase_migrations.schema_migrations`)).rows.map((r) => r.version),
  );

  for (const file of files) {
    const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
    const name = rest.join("_");
    if (applied.has(version)) {
      console.log(`  ✓ ${file} (already applied)`);
      continue;
    }
    if (statusOnly) {
      console.log(`  · ${file} (pending)`);
      continue;
    }
    const sql = readFileSync(join(dir, file), "utf8");
    process.stdout.write(`  → ${file} ... `);
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query(`insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)`, [
        version,
        name,
        [sql],
      ]);
      await client.query("commit");
      console.log("applied");
    } catch (err) {
      await client.query("rollback");
      console.log("FAILED");
      console.error(`\n${(err as Error).message}`);
      process.exitCode = 1;
      break;
    }
  }
  // Ask PostgREST to reload its schema cache so new tables are visible to the API immediately.
  if (!statusOnly && process.exitCode !== 1) await client.query(`notify pgrst, 'reload schema'`);
} finally {
  await client.end();
}
