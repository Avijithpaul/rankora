import { beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb } from "./harness";

let db: PGlite;

async function signUp(id: string, meta: Record<string, unknown>) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, `${id.slice(-4)}@example.test`, JSON.stringify(meta)]);
  return (await db.query<{ full_name: string | null; avatar_url: string | null }>(`select full_name, avatar_url from public.profiles where id = $1`, [id])).rows[0];
}

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

describe("profile creation for social sign-in", () => {
  it("Google: full_name + avatar_url", async () => {
    expect(await signUp("00000000-0000-4000-8000-00000000c001", { full_name: "Ada Lovelace", avatar_url: "https://lh3.googleusercontent.com/a/x" })).toEqual({
      full_name: "Ada Lovelace",
      avatar_url: "https://lh3.googleusercontent.com/a/x",
    });
  });

  it("GitHub: falls back to name, then user_name", async () => {
    expect((await signUp("00000000-0000-4000-8000-00000000c002", { name: "Grace Hopper", avatar_url: "https://avatars.githubusercontent.com/u/1" })).full_name).toBe("Grace Hopper");
    expect((await signUp("00000000-0000-4000-8000-00000000c003", { user_name: "octocat" })).full_name).toBe("octocat");
  });

  it("ignores non-https avatars and empty names", async () => {
    expect(await signUp("00000000-0000-4000-8000-00000000c004", { full_name: "   ", avatar_url: "javascript:alert(1)" })).toEqual({ full_name: null, avatar_url: null });
  });

  it("email sign-up still works", async () => {
    expect((await signUp("00000000-0000-4000-8000-00000000c005", { full_name: "Email User" })).full_name).toBe("Email User");
  });
});
