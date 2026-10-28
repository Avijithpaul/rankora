/** Small, pure helpers for showing who is signed in. Unit tested in tests/unit/profile.test.ts. */

export type AuthProvider = "google" | "github" | "email";

const PROVIDER_LABEL: Record<AuthProvider, string> = { google: "Google", github: "GitHub", email: "Email & password" };

/** Normalises Supabase's provider names ("google", "github", "email", others) to the ones Rankora offers. */
export function toProvider(value: unknown): AuthProvider {
  return value === "google" || value === "github" ? value : "email";
}

export function providerLabel(p: AuthProvider): string {
  return PROVIDER_LABEL[p];
}

/** Only https image URLs are rendered (OAuth providers serve avatars over https). */
export function safeAvatarUrl(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** "Avijith Paul" → "AP"; "someone@example.com" → "S"; "" → "?". */
export function initialsOf(nameOrEmail: string): string {
  const base = nameOrEmail.includes("@") ? nameOrEmail.split("@")[0] : nameOrEmail;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (nameOrEmail.includes("@")) return parts[0][0].toUpperCase();
  return parts
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

/** Name to show: profile name, else the part of the email before "@", else "Account". */
export function displayName(fullName: string | null | undefined, email: string | null | undefined): string {
  const n = fullName?.trim();
  if (n) return n;
  if (email) return email.split("@")[0];
  return "Account";
}
