import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { FormMessage } from "@/components/ui/form";
import { deleteDemoProjectAction } from "@/lib/actions/workspace";
import { RenameOrgForm } from "./rename-form";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "@/lib/actions/team";
import { getEntitlements } from "@/lib/billing/usage";
import { providerConfig } from "@/lib/env";
import { InviteForm } from "@/components/team/invite-form";
import { SubmitButton } from "@/components/content/submit-button";
import { Select } from "@/components/ui/form";

const TEAM_ERRORS: Record<string, string> = {
  role: "You don't have permission to do that.",
  owner: "Only owners can change or remove another owner.",
  last_owner: "An organization must keep at least one owner. Make someone else owner first.",
  self: "You cannot change your own role.",
};
const TEAM_SAVED: Record<string, string> = { role: "Role updated.", removed: "Member removed.", revoked: "Invitation revoked." };

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrgSettingsPage({ params, searchParams }: PageProps<"/app/[org]/settings">) {
  const { org: slug } = await params;
  const sp = await searchParams;
  const { org, role, user } = await requireOrg(slug);
  const isAdmin = roleAtLeast(role, "admin");
  const isOwner = roleAtLeast(role, "owner");
  const supabase = await createClient();
  const { data: members } = await supabase
    .from("organization_members")
    .select("user_id, role, created_at")
    .eq("organization_id", org.id)
    .order("created_at");
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name").in("id", ids)
    : { data: [] as { id: string; full_name: string | null }[] };
  const [{ data: invites }, { data: logs }, ent] = await Promise.all([
    isAdmin
      ? supabase.from("organization_invitations").select("id, email, role, expires_at").eq("organization_id", org.id).is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at")
      : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string }[] }),
    isAdmin
      ? supabase.from("audit_logs").select("id, action, actor_id, created_at").eq("organization_id", org.id).order("created_at", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as { id: string; action: string; actor_id: string | null; created_at: string }[] }),
    isAdmin && providerConfig().serviceRoleConfigured ? getEntitlements(org.id) : Promise.resolve(null),
  ]);
  const ownerCount = (members ?? []).filter((m) => m.role === "owner").length;
  const nameOf = (id: string) => profiles?.find((p) => p.id === id)?.full_name ?? "Unnamed user";

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Organization" description="Workspace details and team members." />
      <Card>
        <CardHeader title="General" />
        <CardBody>
          <RenameOrgForm orgSlug={org.slug} name={org.name} disabled={!roleAtLeast(role, "admin")} />
          <p className="mt-4 text-xs text-muted">
            Workspace URL: <code>/app/{org.slug}</code> (cannot be changed)
          </p>
        </CardBody>
      </Card>
      {typeof sp.error === "string" && TEAM_ERRORS[sp.error] && <FormMessage>{TEAM_ERRORS[sp.error]}</FormMessage>}
      {typeof sp.saved === "string" && TEAM_SAVED[sp.saved] && <FormMessage tone="success">{TEAM_SAVED[sp.saved]}</FormMessage>}
      <Card>
        <CardHeader title="Members" description={`${members?.length ?? 0} member${members?.length === 1 ? "" : "s"} · roles: owner > admin > member > viewer`} />
        <ul className="divide-y divide-line">
          {(members ?? []).map((m) => {
            const self = m.user_id === user.id;
            const canEdit = !self && isAdmin && !org.is_demo && (m.role !== "owner" || isOwner);
            return (
              <li key={m.user_id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {nameOf(m.user_id)} {self && <span className="text-xs font-normal text-muted">(you)</span>}
                  </p>
                  <p className="text-xs text-muted">Joined {formatDate(m.created_at)}</p>
                </div>
                {canEdit ? (
                  <form action={changeRoleAction} className="flex items-center gap-2">
                    <input type="hidden" name="orgSlug" value={org.slug} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <label className="sr-only" htmlFor={`role-${m.user_id}`}>
                      Role of {nameOf(m.user_id)}
                    </label>
                    <Select id={`role-${m.user_id}`} name="role" defaultValue={m.role} className="h-8 w-28 text-xs">
                      {isOwner && <option value="owner">Owner</option>}
                      <option value="admin">Admin</option>
                      <option value="member">Member</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                    <SubmitButton size="sm" variant="secondary">
                      Save
                    </SubmitButton>
                  </form>
                ) : (
                  <Badge className="capitalize" tone={m.role === "owner" ? "brand" : "neutral"}>
                    {m.role}
                  </Badge>
                )}
                {(canEdit || (self && !org.is_demo && (m.role !== "owner" || ownerCount > 1))) && (
                  <form action={removeMemberAction}>
                    <input type="hidden" name="orgSlug" value={org.slug} />
                    <input type="hidden" name="userId" value={m.user_id} />
                    <SubmitButton size="sm" variant="ghost">
                      {self ? "Leave" : "Remove"}
                    </SubmitButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      {isAdmin && !org.is_demo && (
        <Card>
          <CardHeader title="Invite people" description={ent ? `${ent.usage.members + (invites?.length ?? 0)} of ${ent.limits.members} seats used (members + open invitations) on the ${ent.planName} plan` : undefined} />
          <CardBody className="space-y-4">
            <InviteForm action={inviteMemberAction} orgSlug={org.slug} canInviteAdmins={isOwner} />
            {(invites?.length ?? 0) > 0 && (
              <ul className="divide-y divide-line rounded-lg border border-line text-sm">
                {invites!.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    <Badge className="capitalize">{i.role}</Badge>
                    <span className="text-xs text-muted">expires {formatDate(i.expires_at)}</span>
                    <form action={revokeInvitationAction}>
                      <input type="hidden" name="orgSlug" value={org.slug} />
                      <input type="hidden" name="invitationId" value={i.id} />
                      <SubmitButton size="sm" variant="ghost">
                        Revoke
                      </SubmitButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}

      {isAdmin && (
        <Card>
          <CardHeader title="Activity log" description="Sensitive changes in this organization (latest 50). Visible to owners and admins." />
          {!logs?.length ? (
            <p className="px-5 py-4 text-sm text-muted">No activity recorded yet.</p>
          ) : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto text-sm">
              {logs.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-2 px-5 py-2">
                  <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">{l.action}</code>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{l.actor_id ? nameOf(l.actor_id) : "System"}</span>
                  <span className="text-xs text-muted">{formatDate(l.created_at, { hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {org.is_demo && roleAtLeast(role, "owner") && (
        <Card className="border-demo/30">
          <CardHeader title="Remove Demo Project" description="Deletes this demo workspace and all of its sample data. You can create it again later." />
          <CardBody>
            {sp.error === "delete" && (
              <div className="mb-4">
                <FormMessage>The Demo Project could not be removed. Please try again.</FormMessage>
              </div>
            )}
            <form action={deleteDemoProjectAction}>
              <input type="hidden" name="orgSlug" value={org.slug} />
              <Button type="submit" variant="secondary">
                Remove Demo Project
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
