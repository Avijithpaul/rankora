/**
 * Google OAuth connections (server only, service role).
 * Tokens are stored AES-256-GCM encrypted and are never returned to clients.
 */
import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret, encryptSecret } from "@/lib/security/crypto";
import { providerConfig, publicEnv } from "@/lib/env";
import { GoogleApiError, GOOGLE_ERROR_HELP } from "./errors";
import { refreshAccessToken, revokeToken, type GoogleClient, type TokenSet } from "./oauth";

export function googleClient(): GoogleClient | null {
  const cfg = providerConfig();
  const env = publicEnv();
  if (!cfg.googleOAuth || !cfg.tokenEncryptionConfigured || !cfg.serviceRoleConfigured || !env) return null;
  return {
    clientId: cfg.googleOAuth.clientId,
    clientSecret: cfg.googleOAuth.clientSecret,
    redirectUri: `${env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")}/api/integrations/google/callback`,
  };
}

/** Insert or update the org's connection for this Google account. Returns its id. */
export async function saveConnection(opts: { orgId: string; userId: string; tokens: TokenSet; email: string | null; sub: string | null }): Promise<string> {
  const db = createAdminClient();
  const email = opts.email ?? "unknown";
  const { data: existing } = await db
    .from("oauth_connections")
    .select("id")
    .eq("organization_id", opts.orgId)
    .eq("provider", "google")
    .eq("provider_account_email", email)
    .is("revoked_at", null)
    .maybeSingle();
  const patch = {
    connected_by: opts.userId,
    provider_account_email: email,
    provider_account_id: opts.sub,
    scopes: opts.tokens.scopes,
    access_token_encrypted: encryptSecret(opts.tokens.accessToken),
    token_expires_at: opts.tokens.expiresAt.toISOString(),
    status: "active",
    ...(opts.tokens.refreshToken ? { refresh_token_encrypted: encryptSecret(opts.tokens.refreshToken) } : {}),
  };
  if (existing) {
    const { error } = await db.from("oauth_connections").update(patch).eq("id", existing.id);
    if (error) throw new Error(`Could not update Google connection: ${error.message}`);
    return existing.id;
  }
  if (!opts.tokens.refreshToken) throw new GoogleApiError("Google did not return a refresh token. Remove Rankora's access in your Google account and connect again.", "auth");
  const { data, error } = await db
    .from("oauth_connections")
    .insert({ organization_id: opts.orgId, provider: "google", ...patch })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Could not save Google connection: ${error?.message}`);
  return data.id;
}

async function markExpired(connectionId: string) {
  const db = createAdminClient();
  await db.from("oauth_connections").update({ status: "expired", access_token_encrypted: null }).eq("id", connectionId);
  await db.from("integrations").update({ status: "error", last_error: GOOGLE_ERROR_HELP.auth }).eq("oauth_connection_id", connectionId);
}

/**
 * Returns a valid access token, refreshing it when it expires within 2 minutes.
 * A revoked/invalid refresh token marks the connection expired and its
 * integrations as needing reconnection.
 */
export async function getAccessToken(connectionId: string, deps: { fetchImpl?: typeof fetch; now?: number } = {}): Promise<string> {
  const client = googleClient();
  if (!client) throw new GoogleApiError(GOOGLE_ERROR_HELP.not_configured, "not_configured");
  const db = createAdminClient();
  const { data: c } = await db
    .from("oauth_connections")
    .select("id, status, revoked_at, access_token_encrypted, refresh_token_encrypted, token_expires_at")
    .eq("id", connectionId)
    .maybeSingle();
  if (!c || c.revoked_at || c.status !== "active") throw new GoogleApiError(GOOGLE_ERROR_HELP.auth, "auth");
  const now = deps.now ?? Date.now();
  if (c.access_token_encrypted && c.token_expires_at && new Date(c.token_expires_at).getTime() - now > 120_000) {
    return decryptSecret(c.access_token_encrypted);
  }
  if (!c.refresh_token_encrypted) {
    await markExpired(connectionId);
    throw new GoogleApiError(GOOGLE_ERROR_HELP.auth, "auth");
  }
  try {
    const t = await refreshAccessToken(client, decryptSecret(c.refresh_token_encrypted), deps.fetchImpl);
    await db
      .from("oauth_connections")
      .update({
        access_token_encrypted: encryptSecret(t.accessToken),
        token_expires_at: t.expiresAt.toISOString(),
        ...(t.refreshToken ? { refresh_token_encrypted: encryptSecret(t.refreshToken) } : {}),
      })
      .eq("id", connectionId);
    return t.accessToken;
  } catch (e) {
    if (e instanceof GoogleApiError && e.kind === "auth") await markExpired(connectionId);
    throw e;
  }
}

/** Revoke at Google (best effort), wipe tokens, detach integrations. */
export async function disconnectConnection(connectionId: string) {
  const db = createAdminClient();
  const { data: c } = await db.from("oauth_connections").select("refresh_token_encrypted, access_token_encrypted").eq("id", connectionId).maybeSingle();
  const token = c?.refresh_token_encrypted ?? c?.access_token_encrypted;
  if (token) {
    try {
      await revokeToken(decryptSecret(token));
    } catch {
      /* undecryptable token: still wipe it */
    }
  }
  await db
    .from("oauth_connections")
    .update({ access_token_encrypted: null, refresh_token_encrypted: null, revoked_at: new Date().toISOString(), status: "revoked" })
    .eq("id", connectionId);
  await db
    .from("integrations")
    .update({ status: "disconnected", oauth_connection_id: null, sync_state: {}, last_error: null })
    .eq("oauth_connection_id", connectionId);
}
