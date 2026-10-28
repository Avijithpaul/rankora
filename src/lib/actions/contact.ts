"use server";

import { headers } from "next/headers";
import { contactEmailConfig, providerConfig, publicEnv } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/security/crypto";
import { logEvent } from "@/lib/monitoring";
import { buildContactEmail, contactSchema, sendWithResend } from "@/lib/contact";
import { fieldErrorsOf, formValues, type ActionState } from "@/lib/validation/schemas";

const PER_SENDER_PER_HOUR = 5;
const ALL_SENDERS_PER_DAY = 80; // stays under Resend's free daily allowance

/** Public contact form → email to the site owner via Resend. Signed-out visitors may use it. */
export async function sendContactMessageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData, ["name", "email", "topic", "message"]);

  // Honeypot: real visitors never see or fill this field; pretend success for bots.
  if (String(formData.get("company") ?? "").trim()) return { ok: true, message: "Thanks — your message has been sent." };

  const parsed = contactSchema.safeParse(values);
  if (!parsed.success) return { ok: false, message: "Please check the highlighted fields.", fieldErrors: fieldErrorsOf(parsed.error), values };

  const cfg = contactEmailConfig();
  if (!cfg || !providerConfig().serviceRoleConfigured) {
    return { ok: false, message: "Direct email is not configured yet. Please use the email address on this page.", values };
  }

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const sender = `contact:${sha256(ip).slice(0, 32)}`;
  const admin = createAdminClient();
  const [perSender, global] = await Promise.all([
    admin.rpc("rate_limit_hit_key", { p_key: sender, p_limit: PER_SENDER_PER_HOUR, p_window_seconds: 3600 }),
    admin.rpc("rate_limit_hit_key", { p_key: "contact:all", p_limit: ALL_SENDERS_PER_DAY, p_window_seconds: 86400 }),
  ]);
  if (perSender.error || global.error) {
    await logEvent("error", "contact", "Rate limit check failed", { error: (perSender.error ?? global.error)?.message });
    return { ok: false, message: "Sending is temporarily unavailable. Please use the email address on this page.", values };
  }
  if (!perSender.data || !global.data) {
    return { ok: false, message: "Too many messages for now. Please try again later or email us directly.", values };
  }

  const payload = buildContactEmail(parsed.data, cfg, { site: publicEnv()?.NEXT_PUBLIC_SITE_URL });
  const sent = await sendWithResend(payload, cfg.apiKey);
  if (!sent.ok) {
    await logEvent("error", "contact", "Resend rejected the contact email", { status: sent.status, error: sent.error });
    return { ok: false, message: "Your message could not be sent right now. Please email us directly.", values };
  }
  await logEvent("info", "contact", "Contact message sent", { topic: parsed.data.topic, resendId: sent.id });
  return { ok: true, message: "Thanks — your message has been sent. We'll reply to your email." };
}
