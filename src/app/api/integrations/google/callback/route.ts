import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUser } from "@/lib/auth/dal";
import { authorizeSite } from "@/lib/keywords/site-access";
import { googleClient, saveConnection } from "@/lib/google/connections";
import { checkState, exchangeCode, grantedServices, idTokenClaims } from "@/lib/google/oauth";
import { GoogleApiError } from "@/lib/google/errors";
import { decryptSecret, sha256 } from "@/lib/security/crypto";
import { recordAudit } from "@/lib/audit-log";

/**
 * Google OAuth callback. Validates the state (hash lookup, single use, expiry,
 * same signed-in user, user still a member of the website's organization),
 * exchanges the code with the PKCE verifier and stores encrypted tokens.
 * Tokens never reach the browser.
 */
export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const params = request.nextUrl.searchParams;
  const state = params.get("state") ?? "";
  const db = createAdminClient();

  const { data: row } = state
    ? await db.from("oauth_states").select("*").eq("state_hash", sha256(state)).maybeSingle()
    : { data: null };
  const user = await getUser();
  const verdict = checkState(row, user?.id ?? null);
  const back = row?.redirect_path ?? "/app";
  const go = (code: string) => NextResponse.redirect(new URL(`${back}?google=${code}`, origin));
  if (!verdict.ok) return go(verdict.reason);

  // Single use: claim the state atomically
  const { data: claimed } = await db.from("oauth_states").update({ used_at: new Date().toISOString() }).eq("id", row!.id).is("used_at", null).select("id");
  if (!claimed?.length) return go("state_reused");

  if (params.get("error")) return go(params.get("error") === "access_denied" ? "denied" : "failed");
  const code = params.get("code");
  if (!code || !row!.website_id) return go("failed");

  const access = await authorizeSite(row!.website_id, "member");
  if (!access.ok || access.website.is_demo) return go("forbidden");
  const client = googleClient();
  if (!client) return go("not_configured");

  try {
    const tokens = await exchangeCode(client, code, decryptSecret(row!.code_verifier_encrypted!));
    const granted = grantedServices(tokens.scopes);
    if (!granted.gsc && !granted.ga4) return go("no_scopes");
    const claims = idTokenClaims(tokens.idToken);
    const connectionId = await saveConnection({ orgId: row!.organization_id, userId: user!.id, tokens, email: claims.email, sub: claims.sub });

    for (const [service, provider] of [
      ["gsc", "google_search_console"],
      ["ga4", "google_analytics_4"],
    ] as const) {
      if (!granted[service]) continue;
      const { data: existing } = await db.from("integrations").select("id, oauth_connection_id, external_account_id").eq("website_id", row!.website_id).eq("provider", provider).maybeSingle();
      const sameConnection = existing?.oauth_connection_id === connectionId && existing.external_account_id;
      const patch = {
        oauth_connection_id: connectionId,
        status: sameConnection ? "connected" : "pending",
        last_error: null,
        ...(sameConnection ? {} : { external_account_id: null, external_account_name: null, sync_state: {} }),
      };
      if (existing) await db.from("integrations").update(patch).eq("id", existing.id);
      else await db.from("integrations").insert({ organization_id: row!.organization_id, website_id: row!.website_id, provider, ...patch });
    }
    await recordAudit({
      organizationId: row!.organization_id,
      actorId: user!.id,
      action: "integration.google_connected",
      entityType: "website",
      entityId: row!.website_id,
      metadata: { email: claims.email, gsc: granted.gsc, ga4: granted.ga4 },
    });
    return go(granted.gsc && granted.ga4 ? "connected" : "partial");
  } catch (e) {
    console.error("[google.callback]", e);
    return go(e instanceof GoogleApiError && e.kind === "auth" ? "no_refresh_token" : "failed");
  }
}
