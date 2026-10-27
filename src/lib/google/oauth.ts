/**
 * Google OAuth 2.0 (authorization code + PKCE) for Search Console and GA4.
 * Read-only scopes only. Pure helpers are unit tested; network calls accept an
 * injectable fetch so the token flow can be tested without Google.
 */
import { createHash, randomBytes } from "node:crypto";
import { toGoogleError, GoogleApiError } from "./errors";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const SCOPES = {
  gsc: "https://www.googleapis.com/auth/webmasters.readonly",
  ga4: "https://www.googleapis.com/auth/analytics.readonly",
} as const;

export const BASE_SCOPES = ["openid", "email"];
export const STATE_TTL_MS = 10 * 60_000;

export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function base64url(buf: Buffer) {
  return buf.toString("base64url");
}

/** RFC 7636: verifier 43–128 chars; challenge = BASE64URL(SHA256(verifier)). */
export function createPkce() {
  const verifier = base64url(randomBytes(48));
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string) {
  return base64url(createHash("sha256").update(verifier).digest());
}

export function buildAuthUrl(client: GoogleClient, opts: { state: string; challenge: string; services: ("gsc" | "ga4")[]; loginHint?: string }) {
  const scopes = [...BASE_SCOPES, ...opts.services.map((s) => SCOPES[s])];
  const params = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    response_type: "code",
    scope: scopes.join(" "),
    access_type: "offline", // we need a refresh token for background syncs
    prompt: "consent", // guarantees a refresh token on every connect
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.challenge,
    code_challenge_method: "S256",
  });
  if (opts.loginHint) params.set("login_hint", opts.loginHint);
  return `${GOOGLE_AUTH_URL}?${params}`;
}

export interface StoredState {
  user_id: string;
  website_id: string | null;
  provider: string;
  expires_at: string;
  used_at: string | null;
}

/** Validate a looked-up OAuth state row against the current request. */
export function checkState(row: StoredState | null, currentUserId: string | null, now = Date.now()): { ok: true } | { ok: false; reason: string } {
  if (!row) return { ok: false, reason: "unknown_state" };
  if (row.provider !== "google") return { ok: false, reason: "wrong_provider" };
  if (row.used_at) return { ok: false, reason: "state_reused" };
  if (new Date(row.expires_at).getTime() < now) return { ok: false, reason: "state_expired" };
  if (!currentUserId || currentUserId !== row.user_id) return { ok: false, reason: "different_user" };
  return { ok: true };
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scopes: string[];
  idToken: string | null;
}

type Fetch = typeof fetch;

async function tokenRequest(body: URLSearchParams, fetchImpl: Fetch): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchImpl(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new GoogleApiError(`Google token endpoint unreachable: ${(e as Error).message}`, "network");
  }
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    id_token?: string;
  };
  if (!res.ok || !json.access_token) throw toGoogleError(res.status === 200 ? 400 : res.status, json, "Google OAuth");
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: new Date(Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000),
    scopes: (json.scope ?? "").split(" ").filter(Boolean),
    idToken: json.id_token ?? null,
  };
}

export function exchangeCode(client: GoogleClient, code: string, verifier: string, fetchImpl: Fetch = fetch) {
  return tokenRequest(
    new URLSearchParams({
      code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: client.redirectUri,
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    fetchImpl,
  );
}

export function refreshAccessToken(client: GoogleClient, refreshToken: string, fetchImpl: Fetch = fetch) {
  return tokenRequest(
    new URLSearchParams({
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      grant_type: "refresh_token",
    }),
    fetchImpl,
  );
}

export async function revokeToken(token: string, fetchImpl: Fetch = fetch) {
  try {
    await fetchImpl(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch {
    /* best effort: the token is deleted locally either way */
  }
}

/**
 * Read identity claims from the id_token returned by Google's token endpoint.
 * The token came directly from Google over TLS in the code exchange, so it is
 * only decoded (not used for authentication of the Rankora user).
 */
export function idTokenClaims(idToken: string | null): { sub: string | null; email: string | null } {
  if (!idToken) return { sub: null, email: null };
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as { sub?: string; email?: string };
    return { sub: payload.sub ?? null, email: payload.email?.toLowerCase() ?? null };
  } catch {
    return { sub: null, email: null };
  }
}

export function grantedServices(scopes: string[]) {
  return { gsc: scopes.includes(SCOPES.gsc), ga4: scopes.includes(SCOPES.ga4) };
}
