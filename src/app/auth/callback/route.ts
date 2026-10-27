import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth/redirect";

/**
 * Landing for email confirmation, password recovery and social sign-in
 * (Google / GitHub): exchanges the PKCE code for a session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNextPath(searchParams.get("next")) ?? "/app";

  // Provider / Supabase reported an error (e.g. user cancelled the consent screen)
  const providerError = searchParams.get("error_code") ?? searchParams.get("error");
  if (providerError) {
    const code = /^[a-z_]{1,64}$/.test(providerError) ? providerError : "oauth_failed";
    return NextResponse.redirect(new URL(`/login?error=${code}`, origin));
  }

  const code = searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
    console.error("[auth.callback]", error.code ?? error.message);
  }
  return NextResponse.redirect(new URL("/login?error=confirmation_failed", origin));
}
