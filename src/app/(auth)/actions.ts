"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured, publicEnv } from "@/lib/env";
import {
  fieldErrorsOf,
  forgotPasswordSchema,
  formValues,
  loginSchema,
  newPasswordSchema,
  registerSchema,
  type ActionState,
} from "@/lib/validation/schemas";
import { safeNextPath } from "@/lib/auth/redirect";

const NOT_CONFIGURED: ActionState = {
  ok: false,
  message: "Authentication is not configured. Add your Supabase keys to .env.local (see README).",
};

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const values = formValues(formData, ["email"]);
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Do not reveal whether the email exists.
    const message =
      error.code === "email_not_confirmed"
        ? "Please confirm your email address first — check your inbox."
        : "Incorrect email or password.";
    return { ok: false, message, values };
  }
  redirect(safeNextPath(formData.get("next")) ?? "/app");
}

export async function signUp(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const values = formValues(formData, ["email", "fullName"]);
  const parsed = registerSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };

  const origin = publicEnv()?.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${origin}/auth/callback?next=/onboarding`,
    },
  });
  if (error) {
    const message =
      error.code === "weak_password"
        ? "That password is too weak. Try a longer one."
        : error.code === "over_email_send_rate_limit"
          ? "Too many attempts. Please wait a minute and try again."
          : "We couldn't create your account. Please try again.";
    return { ok: false, message, values };
  }
  // When email confirmation is enabled no session is returned yet.
  if (!data.session) {
    return { ok: true, message: "Check your inbox to confirm your email address, then sign in.", values };
  }
  redirect("/onboarding");
}

export async function signOut() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Password reset
//   1. /forgot-password  -> email with a recovery link (PKCE)
//   2. link -> /auth/callback?next=/reset-password  (code exchanged for a session)
//   3. /reset-password   -> updateUser({ password })
// ---------------------------------------------------------------------------
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const values = formValues(formData, ["email"]);
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };

  const origin = publicEnv()?.NEXT_PUBLIC_SITE_URL ?? (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error?.code === "over_email_send_rate_limit") {
    return { ok: false, message: "Too many requests. Please wait a minute and try again.", values };
  }
  // Same answer whether or not the account exists (no account enumeration).
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
}

export async function updatePassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!isSupabaseConfigured()) return NOT_CONFIGURED;
  const parsed = newPasswordSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };

  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) {
    return { ok: false, message: "Your reset link has expired. Request a new one." };
  }
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    const message =
      error.code === "same_password"
        ? "Choose a password different from your current one."
        : error.code === "weak_password"
          ? "That password is too weak. Try a longer one."
          : error.code === "reauthentication_needed"
            ? "Please sign in again before changing your password."
            : "Could not update your password. Please try again.";
    return { ok: false, message };
  }
  return { ok: true, message: "Your password has been updated." };
}
