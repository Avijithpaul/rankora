"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUser, requireOrg, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfig, publicEnv } from "@/lib/env";
import { recordAudit } from "@/lib/audit-log";
import { notifyUsers } from "@/lib/notifications";
import { acceptInvitation, createInvitation } from "@/lib/team/invitations";
import type { ActionState } from "@/lib/validation/schemas";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")),
  role: z.enum(["admin", "member", "viewer"]),
});

export async function inviteMemberAction(_prev: ActionState, formData: FormData): Promise<ActionState & { inviteUrl?: string }> {
  const { org, role, user } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const values = { email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "member") };
  if (!roleAtLeast(role, "admin")) return { ok: false, message: "Only owners and admins can invite people.", values };
  if (org.is_demo) return { ok: false, message: "The Demo Project cannot have other members.", values };
  if (!providerConfig().serviceRoleConfigured) return { ok: false, message: "This feature is not fully configured on the server yet. Please contact the administrator.", values };
  const parsed = inviteSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid input", values };
  if (parsed.data.role === "admin" && !roleAtLeast(role, "owner")) return { ok: false, message: "Only owners can invite admins.", values };
  const supabase = await createClient();
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "team.invite", p_limit: 20, p_window_seconds: 3600 });
  if (!allowed) return { ok: false, message: "Too many invitations this hour.", values };
  const r = await createInvitation({ orgId: org.id, email: parsed.data.email, role: parsed.data.role, invitedBy: user.id });
  if (!r.ok) return { ok: false, message: r.message, values };
  revalidatePath(`/app/${org.slug}/settings`);
  const site = publicEnv()?.NEXT_PUBLIC_SITE_URL ?? "";
  // No email provider is configured: the link is shown once to the inviter to share.
  return { ok: true, message: `Invitation created for ${parsed.data.email}. Share this link with them (valid 7 days, shown once):`, inviteUrl: `${site}/invite/${r.token}` };
}

export async function revokeInvitationAction(formData: FormData) {
  const { org, role, user } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const id = String(formData.get("invitationId") ?? "");
  if (!roleAtLeast(role, "admin") || !/^[0-9a-f-]{36}$/i.test(id)) redirect(`/app/${org.slug}/settings?error=role`);
  await createAdminClient().from("organization_invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organization_id", org.id).is("accepted_at", null);
  await recordAudit({ organizationId: org.id, actorId: user.id, action: "member.invite_revoked", entityType: "invitation", entityId: id });
  revalidatePath(`/app/${org.slug}/settings`);
  redirect(`/app/${org.slug}/settings?saved=revoked`);
}

const ROLES = ["owner", "admin", "member", "viewer"] as const;

/** Role changes go through RLS + triggers as the user, so owner rules are enforced by the database too. */
export async function changeRoleAction(formData: FormData) {
  const { org, role, user } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const target = String(formData.get("userId") ?? "");
  const newRole = String(formData.get("role") ?? "") as (typeof ROLES)[number];
  const back = `/app/${org.slug}/settings`;
  if (!roleAtLeast(role, "admin") || !ROLES.includes(newRole) || !/^[0-9a-f-]{36}$/i.test(target)) redirect(`${back}?error=role`);
  if (target === user.id) redirect(`${back}?error=self`);
  const supabase = await createClient();
  const { error } = await supabase.from("organization_members").update({ role: newRole }).eq("organization_id", org.id).eq("user_id", target);
  if (error) redirect(`${back}?error=${/owner/i.test(error.message) ? "owner" : "role"}`);
  await recordAudit({ organizationId: org.id, actorId: user.id, action: "member.role_changed", entityType: "member", entityId: target, metadata: { role: newRole } });
  await notifyUsers(org.id, [target], { type: "member.role_changed", title: `Your role in ${org.name} is now ${newRole}`, link: "settings" });
  revalidatePath(back);
  redirect(`${back}?saved=role`);
}

export async function removeMemberAction(formData: FormData) {
  const { org, role, user } = await requireOrg(String(formData.get("orgSlug") ?? ""));
  const target = String(formData.get("userId") ?? "");
  const back = `/app/${org.slug}/settings`;
  const leaving = target === user.id;
  if ((!leaving && !roleAtLeast(role, "admin")) || !/^[0-9a-f-]{36}$/i.test(target)) redirect(`${back}?error=role`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("organization_members").delete().eq("organization_id", org.id).eq("user_id", target).select("user_id");
  if (error) redirect(`${back}?error=${/last owner|at least one owner/i.test(error.message) ? "last_owner" : /owner/i.test(error.message) ? "owner" : "role"}`);
  if (!data?.length) redirect(`${back}?error=role`);
  await recordAudit({ organizationId: org.id, actorId: user.id, action: leaving ? "member.left" : "member.removed", entityType: "member", entityId: target });
  if (leaving) redirect("/app");
  revalidatePath(back);
  redirect(`${back}?saved=removed`);
}

export async function acceptInvitationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  const r = await acceptInvitation(token, { id: user.id, email: user.email ?? null });
  if (!r.ok) redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(r.message)}`);
  revalidatePath("/app", "layout");
  redirect(`/app/${r.orgSlug}`);
}
