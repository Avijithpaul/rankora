import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { STATE_FILE, type E2EState, type E2EUser } from "./fixtures";

/** Service-role client for test fixtures only (reads .env.local via process.loadEnvFile). */
export function adminClient() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    /* env may already be present */
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("E2E tests need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export default async function globalSetup() {
  const db = adminClient();
  const runId = randomUUID().slice(0, 8);
  const makeUser = async (label: string): Promise<E2EUser> => {
    const email = `e2e-${label}-${runId}@rankora.invalid`;
    const password = `${randomBytes(18).toString("base64url")}A1`;
    const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: `E2E ${label}` } });
    if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
    return { id: data.user.id, email, password };
  };
  const [owner, invitee, outsider] = [await makeUser("owner"), await makeUser("invitee"), await makeUser("outsider")];

  const mkOrg = async (name: string, slug: string, ownerId: string, plan: string) => {
    const { data: org, error } = await db.from("organizations").insert({ name, slug, created_by: ownerId }).select("id, slug").single();
    if (error || !org) throw new Error(`org failed: ${error?.message}`);
    await db.from("organization_members").insert({ organization_id: org.id, user_id: ownerId, role: "owner" });
    await db.from("subscriptions").upsert({ organization_id: org.id, plan_id: plan, status: "active", provider: "manual" }, { onConflict: "organization_id" });
    await db.from("profiles").update({ onboarding_completed_at: new Date().toISOString(), last_organization_id: org.id }).eq("id", ownerId);
    return org;
  };
  const org = await mkOrg("E2E Agency", `e2e-${runId}`, owner.id, "starter");
  const other = await mkOrg("E2E Other", `e2e-other-${runId}`, outsider.id, "free");
  await db.from("profiles").update({ onboarding_completed_at: new Date().toISOString() }).eq("id", invitee.id);
  const { data: site, error } = await db
    .from("websites")
    .insert({ organization_id: org.id, name: "Example shop", domain: "example.com", base_url: "https://example.com/", created_by: owner.id })
    .select("id")
    .single();
  if (error || !site) throw new Error(`website failed: ${error?.message}`);

  const state: E2EState = { runId, owner, invitee, outsider, orgSlug: org.slug, orgId: org.id, siteId: site.id, outsiderOrgSlug: other.slug };
  mkdirSync("test-results/e2e", { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state));
}
