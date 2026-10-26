import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { providerConfig } from "@/lib/env";
import type { Json } from "@/lib/supabase/database.types";

/**
 * Append to audit_logs. Clients cannot write this table (RLS + grants), so it
 * goes through the service role. Never throws: auditing must not break the action.
 */
export async function recordAudit(entry: {
  organizationId: string | null;
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, Json>;
}) {
  if (!providerConfig().serviceRoleConfigured) return;
  try {
    await createAdminClient().from("audit_logs").insert({
      organization_id: entry.organizationId,
      actor_id: entry.actorId,
      action: entry.action,
      entity_type: entry.entityType ?? null,
      entity_id: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
    });
  } catch (err) {
    console.error("[audit] failed to record", entry.action, err);
  }
}
