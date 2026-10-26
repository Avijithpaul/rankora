import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getUser, roleAtLeast, type OrgRole } from "@/lib/auth/dal";
import type { Tables } from "@/lib/supabase/database.types";

export type SiteAccess =
  | { ok: true; website: Tables<"websites">; role: OrgRole; planId: string }
  | { ok: false; status: 401 | 403 | 404; error: string };

/** Resolve a website for an API route AS THE USER (RLS): other tenants' sites are 404. */
export async function authorizeSite(siteId: string, minRole: OrgRole = "viewer"): Promise<SiteAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) return { ok: false, status: 404, error: "Not found" };
  const user = await getUser();
  if (!user) return { ok: false, status: 401, error: "Sign in required" };
  const supabase = await createClient();
  const { data: website } = await supabase.from("websites").select("*").eq("id", siteId).maybeSingle();
  if (!website) return { ok: false, status: 404, error: "Not found" };
  const [{ data: member }, { data: org }] = await Promise.all([
    supabase.from("organization_members").select("role").eq("organization_id", website.organization_id).eq("user_id", user.id).maybeSingle(),
    supabase.from("organizations").select("plan_id").eq("id", website.organization_id).maybeSingle(),
  ]);
  if (!member || !org) return { ok: false, status: 404, error: "Not found" };
  if (!roleAtLeast(member.role, minRole)) return { ok: false, status: 403, error: "Insufficient role" };
  return { ok: true, website, role: member.role, planId: org.plan_id };
}
