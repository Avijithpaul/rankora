import { describe, expect, it } from "vitest";
import { isOAuthProvider, oauthErrorMessage, parseAuthSettings } from "@/lib/auth/oauth";
import { safeNextPath } from "@/lib/auth/redirect";

describe("social sign-in helpers", () => {
  it("only accepts supported providers", () => {
    expect(isOAuthProvider("google")).toBe(true);
    expect(isOAuthProvider("github")).toBe(true);
    expect(isOAuthProvider("facebook")).toBe(false);
    expect(isOAuthProvider(null)).toBe(false);
    expect(isOAuthProvider("google; drop table")).toBe(false);
  });

  it("reads enabled providers from Supabase auth settings", () => {
    expect(parseAuthSettings({ external: { google: true, github: false, email: true } })).toEqual({ google: true, github: false });
    expect(parseAuthSettings({ external: { google: "true" } })).toEqual({ google: false, github: false });
    expect(parseAuthSettings(null)).toEqual({ google: false, github: false });
  });

  it("maps callback errors to safe messages (never echoes raw input)", () => {
    expect(oauthErrorMessage("access_denied")).toMatch(/cancelled/);
    expect(oauthErrorMessage("provider_disabled")).toMatch(/not enabled/);
    expect(oauthErrorMessage("<script>alert(1)</script>")).toBe("Sign-in failed. Please try again.");
    expect(oauthErrorMessage(null)).toBeNull();
  });

  it("post-login redirect after OAuth stays on this site", () => {
    expect(safeNextPath("/onboarding")).toBe("/onboarding");
    expect(safeNextPath("https://evil.example/phish")).toBeNull();
    expect(safeNextPath("//evil.example")).toBeNull();
  });
});
