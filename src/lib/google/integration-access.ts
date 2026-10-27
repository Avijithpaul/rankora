import "server-only";
import { createClient } from "@/lib/supabase/server";
import { authorizeSite } from "@/lib/keywords/site-access";
import type { OrgRole } from "@/lib/auth/dal";
import type { Tables } from "@/lib/supabase/database.types";

export type IntegrationAccess =
  | { ok: true; integration: Pick<Tables<"integrations">, "id" | "website_id" | "provider" | "status" | "oauth_connection_id" | "external_account_id">; website: Tables<"websites">; role: OrgRole }
  | { ok: false; status: 401 | 403 | 404; error: string };

/** Resolve an integration AS THE USER (RLS) and require a role on its website. */
export async function authorizeIntegration(integrationId: string, minRole: OrgRole = "member"): Promise<IntegrationAccess> {
  if (!/^[0-9a-f-]{36}$/i.test(integrationId)) return { ok: false, status: 404, error: "Not found" };
  const supabase = await createClient();
  const { data: integration } = await supabase
    .from("integrations")
    .select("id, website_id, provider, status, oauth_connection_id, external_account_id")
    .eq("id", integrationId)
    .maybeSingle();
  if (!integration) return { ok: false, status: 404, error: "Not found" };
  const site = await authorizeSite(integration.website_id, minRole);
  if (!site.ok) return site;
  if (site.website.is_demo) return { ok: false, status: 403, error: "The Demo Project cannot connect Google accounts." };
  return { ok: true, integration, website: site.website, role: site.role };
}
