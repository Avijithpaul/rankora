import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfig } from "@/lib/env";

export interface NotificationInput {
  type: string;
  title: string;
  body?: string | null;
  /** path relative to /app/[org]/ (e.g. "billing", "sites/<id>/tasks/<id>"), or null */
  link?: string | null;
}

/**
 * In-app notifications (written with the service role; users read their own via RLS).
 * Never throws: a failed notification must not break the action that caused it.
 */
export async function notifyUsers(orgId: string, userIds: string[], n: NotificationInput) {
  const ids = [...new Set(userIds)].filter(Boolean);
  if (!ids.length || !providerConfig().serviceRoleConfigured) return;
  try {
    const db = createAdminClient();
    const { data: org } = await db.from("organizations").select("slug").eq("id", orgId).maybeSingle();
    const link = n.link && org ? `/app/${org.slug}/${n.link.replace(/^\/+/, "")}`.slice(0, 500) : null;
    await db.from("notifications").insert(
      ids.map((user_id) => ({ user_id, organization_id: orgId, type: n.type.slice(0, 60), title: n.title.slice(0, 200), body: n.body?.slice(0, 2000) ?? null, link })),
    );
  } catch (err) {
    console.error("[notify] failed", n.type, err);
  }
}

export async function notifyOrgAdmins(orgId: string, n: NotificationInput, opts: { exclude?: string } = {}) {
  if (!providerConfig().serviceRoleConfigured) return;
  try {
    const { data } = await createAdminClient().from("organization_members").select("user_id").eq("organization_id", orgId).in("role", ["owner", "admin"]);
    await notifyUsers(orgId, (data ?? []).map((m) => m.user_id).filter((id) => id !== opts.exclude), n);
  } catch (err) {
    console.error("[notify] admins failed", n.type, err);
  }
}
