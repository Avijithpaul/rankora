/**
 * Social sign-in (Google, GitHub) through Supabase Auth.
 * Which providers are enabled is read from the project's public auth settings,
 * so buttons for providers that are not configured are shown as unavailable
 * instead of failing after a redirect.
 */
import "server-only";
import { publicEnv } from "@/lib/env";

export const OAUTH_PROVIDERS = ["google", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

export function isOAuthProvider(v: unknown): v is OAuthProvider {
  return typeof v === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(v);
}

export type EnabledProviders = Record<OAuthProvider, boolean>;

/** Parse `GET /auth/v1/settings` → which social providers are enabled. */
export function parseAuthSettings(json: unknown): EnabledProviders {
  const external = (json as { external?: Record<string, unknown> } | null)?.external ?? {};
  return { google: external.google === true, github: external.github === true };
}

export async function getEnabledProviders(): Promise<EnabledProviders> {
  const env = publicEnv();
  if (!env) return { google: false, github: false };
  try {
    const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
      // provider settings rarely change; refresh every minute
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { google: false, github: false };
    return parseAuthSettings(await res.json());
  } catch {
    return { google: false, github: false };
  }
}

/** Map Supabase / provider callback errors to a safe, user-facing message. */
export function oauthErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  switch (code) {
    case "access_denied":
      return "Sign-in was cancelled.";
    case "provider_disabled":
    case "validation_failed":
      return "That sign-in method is not enabled yet.";
    case "provider_email_needs_verification":
      return "Please verify your email address with the provider first.";
    case "confirmation_failed":
      return "That confirmation link is invalid or has expired.";
    case "oauth_failed":
      return "We couldn't complete sign-in with that provider. Please try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}
