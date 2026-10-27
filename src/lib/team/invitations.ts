import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { recordAudit } from "@/lib/audit-log";
import { notifyOrgAdmins } from "@/lib/notifications";
import { getEntitlements } from "@/lib/billing/usage";
import { checkLimit, limitMessage } from "@/lib/billing/entitlements";

export const INVITE_TTL_DAYS = 7;
export type InviteRole = "admin" | "member" | "viewer";

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type InviteResult = { ok: true; token: string } | { ok: false; message: string };

/**
 * Creates an invitation and returns the raw token ONCE (only its SHA-256 is stored).
 * Members + open invitations may not exceed the plan's member limit.
 */
export async function createInvitation(opts: { orgId: string; email: string; role: InviteRole; invitedBy: string }): Promise<InviteResult> {
  const db = createAdminClient();
  const email = opts.email.trim().toLowerCase();
  const [{ data: existingMember }, { count: openInvites }, ent] = await Promise.all([
    db.rpc("org_member_by_email", { p_org: opts.orgId, p_email: email }),
    db.from("organization_invitations").select("id", { count: "exact", head: true }).eq("organization_id", opts.orgId).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    getEntitlements(opts.orgId),
  ]);
  if (existingMember) return { ok: false, message: "That person is already a member." };
  const check = checkLimit(ent.limits.members, ent.usage.members + (openInvites ?? 0));
  if (!check.allowed) return { ok: false, message: limitMessage("members", check, ent.planName) };
  // replace any open invitation for the same email (new token, new expiry)
  await db.from("organization_invitations").update({ revoked_at: new Date().toISOString() }).eq("organization_id", opts.orgId).eq("email", email).is("accepted_at", null).is("revoked_at", null);
  const token = randomBytes(32).toString("base64url");
  const { data, error } = await db
    .from("organization_invitations")
    .insert({ organization_id: opts.orgId, email, role: opts.role, token_hash: hashToken(token), invited_by: opts.invitedBy, expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString() })
    .select("id")
    .single();
  if (error || !data) return { ok: false, message: "The invitation could not be created." };
  await recordAudit({ organizationId: opts.orgId, actorId: opts.invitedBy, action: "member.invited", entityType: "invitation", entityId: data.id, metadata: { email, role: opts.role } });
  return { ok: true, token };
}

export interface InvitationView {
  id: string;
  orgId: string;
  orgName: string;
  orgSlug: string;
  email: string;
  role: InviteRole;
  state: "open" | "expired" | "accepted" | "revoked";
}

export async function findInvitation(token: string): Promise<InvitationView | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const { data } = await createAdminClient()
    .from("organization_invitations")
    .select("id, organization_id, email, role, expires_at, accepted_at, revoked_at, organizations(name, slug)")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!data) return null;
  const org = data.organizations as unknown as { name: string; slug: string };
  const state = data.revoked_at ? "revoked" : data.accepted_at ? "accepted" : new Date(data.expires_at) < new Date() ? "expired" : "open";
  return { id: data.id, orgId: data.organization_id, orgName: org.name, orgSlug: org.slug, email: data.email, role: data.role as InviteRole, state };
}

/** Accepts an invitation for the signed-in user; the email must match the invited address. */
export async function acceptInvitation(token: string, user: { id: string; email: string | null }): Promise<{ ok: true; orgSlug: string } | { ok: false; message: string }> {
  const inv = await findInvitation(token);
  if (!inv || inv.state === "revoked") return { ok: false, message: "This invitation is not valid." };
  if (inv.state === "expired") return { ok: false, message: "This invitation has expired. Ask for a new one." };
  if (inv.state === "accepted") return { ok: false, message: "This invitation was already used." };
  if (!user.email || user.email.toLowerCase() !== inv.email) return { ok: false, message: `This invitation is for ${inv.email}. Sign in with that email address.` };
  const db = createAdminClient();
  // the address must be proven, otherwise anyone could register with it and take the seat
  const { data: authUser } = await db.auth.admin.getUserById(user.id);
  if (!authUser.user?.email_confirmed_at) return { ok: false, message: "Confirm your email address first, then open the invitation again." };
  const { data: already } = await db.from("organization_members").select("user_id").eq("organization_id", inv.orgId).eq("user_id", user.id).maybeSingle();
  if (!already) {
    const { error } = await db.from("organization_members").insert({ organization_id: inv.orgId, user_id: user.id, role: inv.role });
    if (error) return { ok: false, message: /Member limit/.test(error.message) ? "This organization has reached its member limit." : "Could not join the organization." };
  }
  // claim the invitation atomically (single use)
  const { data: claimed } = await db.from("organization_invitations").update({ accepted_at: new Date().toISOString(), accepted_by: user.id }).eq("id", inv.id).is("accepted_at", null).select("id");
  if (!claimed?.length && !already) return { ok: false, message: "This invitation was already used." };
  await recordAudit({ organizationId: inv.orgId, actorId: user.id, action: "member.joined", entityType: "invitation", entityId: inv.id, metadata: { role: inv.role } });
  await notifyOrgAdmins(inv.orgId, { type: "member.joined", title: `${inv.email} joined ${inv.orgName}`, body: `Role: ${inv.role}`, link: "settings" }, { exclude: user.id });
  return { ok: true, orgSlug: inv.orgSlug };
}
