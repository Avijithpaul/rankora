import { NextResponse, type NextRequest } from "next/server";
import { authorizeSite } from "@/lib/keywords/site-access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleClient } from "@/lib/google/connections";
import { buildAuthUrl, createPkce, STATE_TTL_MS } from "@/lib/google/oauth";
import { encryptSecret, randomToken, sha256 } from "@/lib/security/crypto";

/**
 * Starts Google OAuth for Search Console / GA4.
 * GET /api/integrations/google/start?site=<websiteId>&services=gsc,ga4
 * State is random, stored only as a SHA-256 hash, single-use, bound to the
 * user + website, and expires in 10 minutes. PKCE (S256) protects the code.
 */
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("site") ?? "";
  const access = await authorizeSite(siteId, "member");
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status });

  const supabase = await createClient();
  const { data: org } = await supabase.from("organizations").select("slug").eq("id", access.website.organization_id).single();
  const back = `/app/${org?.slug}/sites/${siteId}/integrations`;
  const fail = (code: string) => NextResponse.redirect(new URL(`${back}?google=${code}`, request.nextUrl.origin));

  if (access.website.is_demo) return fail("demo");
  const client = googleClient();
  if (!client) return fail("not_configured");
  const { data: allowed } = await supabase.rpc("rate_limit_hit", { p_bucket: "google.connect", p_limit: 10, p_window_seconds: 3600 });
  if (!allowed) return fail("rate_limited");

  const requested = (request.nextUrl.searchParams.get("services") ?? "gsc,ga4").split(",");
  const services = (["gsc", "ga4"] as const).filter((s) => requested.includes(s));
  if (services.length === 0) return fail("invalid");

  const { data: auth } = await supabase.auth.getClaims();
  const state = randomToken(32);
  const pkce = createPkce();
  const db = createAdminClient();
  await db.from("oauth_states").delete().lt("expires_at", new Date().toISOString());
  const { error } = await db.from("oauth_states").insert({
    state_hash: sha256(state),
    user_id: auth!.claims.sub,
    organization_id: access.website.organization_id,
    website_id: siteId,
    provider: "google",
    code_verifier_encrypted: encryptSecret(pkce.verifier),
    redirect_path: back,
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });
  if (error) {
    console.error("[google.start]", error);
    return fail("failed");
  }
  return NextResponse.redirect(buildAuthUrl(client, { state, challenge: pkce.challenge, services: [...services] }));
}
