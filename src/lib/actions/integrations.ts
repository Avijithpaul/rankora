"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireWebsite, roleAtLeast } from "@/lib/auth/dal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { disconnectConnection, getAccessToken } from "@/lib/google/connections";
import { listSites } from "@/lib/google/search-console";
import { listProperties } from "@/lib/google/analytics";
import { GoogleApiError, GOOGLE_ERROR_HELP } from "@/lib/google/errors";
import { startSync } from "@/lib/google/sync";
import { recordAudit } from "@/lib/audit-log";

async function ctxFrom(formData: FormData) {
  const orgSlug = String(formData.get("orgSlug") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const ctx = await requireWebsite(orgSlug, siteId);
  const back = `/app/${orgSlug}/sites/${siteId}/integrations`;
  if (!roleAtLeast(ctx.role, "member") || ctx.website.is_demo) redirect(`${back}?google=forbidden`);
  return { ...ctx, back };
}

async function loadIntegration(websiteId: string, integrationId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("integrations")
    .select("id, provider, oauth_connection_id, external_account_id")
    .eq("id", integrationId)
    .eq("website_id", websiteId)
    .maybeSingle();
  return data;
}

/**
 * Save the chosen Search Console site / GA4 property. The value must be one the
 * connected Google account can actually access (re-checked with Google here),
 * then the first sync is queued.
 */
export async function selectPropertyAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const integration = await loadIntegration(ctx.website.id, String(formData.get("integrationId") ?? ""));
  const value = String(formData.get("property") ?? "");
  if (!integration?.oauth_connection_id || !value) redirect(`${ctx.back}?google=invalid`);

  let name: string | null = null;
  try {
    const token = await getAccessToken(integration.oauth_connection_id);
    if (integration.provider === "google_search_console") {
      const site = (await listSites(token)).find((s) => s.siteUrl === value);
      if (!site) redirect(`${ctx.back}?google=property_not_found`);
      name = site.siteUrl.replace(/^sc-domain:/, "Domain: ");
    } else {
      const prop = (await listProperties(token)).find((p) => p.property === value);
      if (!prop) redirect(`${ctx.back}?google=property_not_found`);
      name = `${prop.displayName} (${prop.account})`;
    }
  } catch (e) {
    if (e instanceof GoogleApiError) redirect(`${ctx.back}?google=api_error&message=${encodeURIComponent(GOOGLE_ERROR_HELP[e.kind])}`);
    throw e;
  }

  const db = createAdminClient();
  const changed = integration.external_account_id !== value;
  await db
    .from("integrations")
    .update({ external_account_id: value, external_account_name: name, status: "connected", last_error: null, ...(changed ? { last_synced_at: null } : {}) })
    .eq("id", integration.id);
  if (changed) {
    // A different property: remove data synced from the previous one for this website.
    const tables = integration.provider === "google_search_console"
      ? (["search_console_daily", "search_console_queries", "search_console_pages"] as const)
      : (["analytics_daily", "analytics_pages"] as const);
    for (const t of tables) await db.from(t).delete().eq("website_id", ctx.website.id).neq("source", "demo");
  }
  await startSync(integration.id, "initial");
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "integration.property_selected", entityType: "integration", entityId: integration.id, metadata: { property: value } });
  revalidatePath(ctx.back);
  redirect(`${ctx.back}?sync=${integration.id}`);
}

export async function syncNowAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const integration = await loadIntegration(ctx.website.id, String(formData.get("integrationId") ?? ""));
  if (!integration?.external_account_id) redirect(`${ctx.back}?google=invalid`);
  await startSync(integration.id, formData.get("full") === "1" ? "initial" : "incremental");
  redirect(`${ctx.back}?sync=${integration.id}`);
}

/** Detach one integration from this website (keeps the Google connection for other sites). */
export async function detachIntegrationAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  const integration = await loadIntegration(ctx.website.id, String(formData.get("integrationId") ?? ""));
  if (!integration) redirect(`${ctx.back}?google=invalid`);
  const db = createAdminClient();
  await db
    .from("integrations")
    .update({ status: "disconnected", oauth_connection_id: null, external_account_id: null, external_account_name: null, sync_state: {}, last_error: null })
    .eq("id", integration.id);
  if (formData.get("deleteData") === "on") {
    const tables = integration.provider === "google_search_console"
      ? (["search_console_daily", "search_console_queries", "search_console_pages"] as const)
      : (["analytics_daily", "analytics_pages"] as const);
    for (const t of tables) await db.from(t).delete().eq("website_id", ctx.website.id).neq("source", "demo");
  }
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "integration.disconnected", entityType: "integration", entityId: integration.id });
  revalidatePath(ctx.back);
  redirect(`${ctx.back}?google=disconnected`);
}

/** Revoke the Google account's access entirely (admins): affects every website using it. */
export async function revokeGoogleAction(formData: FormData) {
  const ctx = await ctxFrom(formData);
  if (!roleAtLeast(ctx.role, "admin")) redirect(`${ctx.back}?google=forbidden`);
  const connectionId = String(formData.get("connectionId") ?? "");
  const supabase = await createClient();
  const { data: conn } = await supabase.from("oauth_connections").select("id").eq("id", connectionId).eq("organization_id", ctx.org.id).maybeSingle();
  if (!conn) redirect(`${ctx.back}?google=invalid`);
  await disconnectConnection(conn.id);
  await recordAudit({ organizationId: ctx.org.id, actorId: ctx.user.id, action: "integration.google_revoked", entityType: "oauth_connection", entityId: conn.id });
  revalidatePath(ctx.back);
  redirect(`${ctx.back}?google=revoked`);
}
