/**
 * Environment access. Public values (NEXT_PUBLIC_*) are safe in the browser;
 * everything else is read only on the server through `serverEnv()`.
 */
import { z } from "zod";

const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  NEXT_PUBLIC_SITE_URL: z.url().default("http://localhost:3000"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

/** Returns null (instead of throwing) so the UI can show a setup screen. */
export function publicEnv(): PublicEnv | null {
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
  });
  return parsed.success ? parsed.data : null;
}

export function isSupabaseConfigured(): boolean {
  return publicEnv() !== null;
}

/** Optional server-side provider credentials. Missing => feature shows "not connected". */
export function providerConfig() {
  return {
    googleOAuth:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
        : null,
    pagespeedApiKey: process.env.PAGESPEED_API_KEY || null,
    dataForSeo:
      process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD
        ? { login: process.env.DATAFORSEO_LOGIN, password: process.env.DATAFORSEO_PASSWORD }
        : null,
    aiProvider: aiConfig() ? "anthropic" : null,
    backlinkProvider: process.env.BACKLINK_PROVIDER === "dataforseo" ? ("dataforseo" as const) : null,
    tokenEncryptionConfigured: Boolean(process.env.TOKEN_ENCRYPTION_KEY),
    serviceRoleConfigured: Boolean(process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY),
  };
}

/** Optional AI suggestions (Content Optimizer). Without a key the feature is shown as not connected. */
export function aiConfig(): { apiKey: string; model: string } | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return { apiKey, model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5" };
}
