/**
 * Data Access Layer: the single place server code asks "who is the user and
 * what may they access?". Every page, route handler and server action goes
 * through here. Postgres RLS remains the final enforcement layer.
 */
import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import type { Enums, Tables } from "@/lib/supabase/database.types";
import { toProvider, type AuthProvider } from "@/lib/profile";

export type OrgRole = Enums<"org_role">;
export interface SessionUser {
  id: string;
  email: string | null;
  /** how this session signed in (from the verified JWT's app_metadata) */
  provider: AuthProvider;
}

const ROLE_RANK: Record<OrgRole, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };

export function roleAtLeast(role: OrgRole, min: OrgRole) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

/** Verified current user (JWT signature checked via getClaims), or null. */
export const getUser = cache(async (): Promise<SessionUser | null> => {
  await cookies(); // always request-time
  if (!isSupabaseConfigured()) return null;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const appMeta = (data.claims.app_metadata ?? {}) as { provider?: unknown };
  return { id: data.claims.sub, email: (data.claims.email as string | undefined) ?? null, provider: toProvider(appMeta.provider) };
});

export interface AccountDetails {
  createdAt: string | null;
  lastSignInAt: string | null;
  /** every sign-in method linked to this account, with the email each one uses */
  identities: { provider: AuthProvider; email: string | null }[];
}

/**
 * Sign-in history and linked identities for the profile page. Calls the Auth server
 * (getUser), so use it only where the details are shown, not in layouts.
 */
export const getAccountDetails = cache(async (): Promise<AccountDetails | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  const u = data.user;
  const identities = (u.identities ?? []).map((i) => ({
    provider: toProvider(i.provider),
    email: typeof i.identity_data?.email === "string" ? i.identity_data.email : null,
  }));
  return { createdAt: u.created_at ?? null, lastSignInAt: u.last_sign_in_at ?? null, identities };
});

export async function requireUser(next?: string): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  return user;
}

export type OrgContext = {
  org: Pick<Tables<"organizations">, "id" | "name" | "slug" | "plan_id" | "is_demo">;
  role: OrgRole;
  user: SessionUser;
};

export const listMemberships = cache(async () => {
  const user = await requireUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, organizations!inner(id, name, slug, plan_id, is_demo)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((m) => ({ role: m.role, org: m.organizations }));
});

/** Resolve an organization by slug for the current user, or 404. */
export const requireOrg = cache(async (slug: string, minRole: OrgRole = "viewer"): Promise<OrgContext> => {
  const user = await requireUser();
  const memberships = await listMemberships();
  const match = memberships.find((m) => m.org.slug === slug);
  if (!match) notFound();
  if (!roleAtLeast(match.role, minRole)) {
    throw new Error("You do not have permission to perform this action in this organization.");
  }
  return { org: match.org, role: match.role, user };
});

export type WebsiteRow = Tables<"websites">;

export const listWebsites = cache(async (orgId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("websites")
    .select("*")
    .eq("organization_id", orgId)
    .neq("status", "archived")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
});

/** Resolve a website inside an organization the user can access, or 404. */
export const requireWebsite = cache(async (orgSlug: string, siteId: string, minRole: OrgRole = "viewer") => {
  const ctx = await requireOrg(orgSlug, minRole);
  if (!/^[0-9a-f-]{36}$/i.test(siteId)) notFound();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("websites")
    .select("*")
    .eq("id", siteId)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) notFound();
  return { ...ctx, website: data };
});
