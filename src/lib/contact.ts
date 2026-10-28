/**
 * Contact form: validation, the email that is sent, and the Resend API call.
 * Pure apart from `sendWithResend`, which takes an injectable fetch for tests.
 */
import { z } from "zod";

export const CONTACT_TOPICS = [
  "General question",
  "Plans & billing",
  "Product help",
  "Partnership or data provider",
  "Academic project / demo",
  "Security report",
] as const;

export const contactSchema = z.object({
  name: z.string().trim().max(80, "Name is too long").optional().default(""),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address so we can reply")),
  topic: z.enum(CONTACT_TOPICS, "Choose a topic"),
  message: z.string().trim().min(10, "Please write a short message (at least 10 characters).").max(4000, "Message is too long (4,000 characters max)."),
});

export type ContactInput = z.infer<typeof contactSchema>;

export interface ContactEmailConfig {
  apiKey: string;
  to: string;
  from: string;
}

export interface ResendPayload {
  from: string;
  to: string[];
  reply_to: string;
  subject: string;
  text: string;
}

/** One line, no control characters: header values must never carry user-supplied newlines. */
const oneLine = (s: string) => s.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();

export function buildContactEmail(input: ContactInput, cfg: Pick<ContactEmailConfig, "to" | "from">, meta: { site?: string } = {}): ResendPayload {
  const name = oneLine(input.name ?? "");
  const subject = `[Rankora] ${input.topic}${name ? ` — ${name}` : ""}`.slice(0, 200);
  const text = [
    input.message,
    "",
    "—",
    `From: ${name || "(no name given)"} <${input.email}>`,
    `Topic: ${input.topic}`,
    meta.site ? `Sent from: ${meta.site}/contact` : null,
    "Reply to this email to answer the sender directly.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return { from: cfg.from, to: [cfg.to], reply_to: input.email, subject: oneLine(subject), text };
}

export async function sendWithResend(payload: ResendPayload, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; id: string } | { ok: false; status: number; error: string }> {
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok || !json.id) return { ok: false, status: res.status, error: json.message ?? json.name ?? `HTTP ${res.status}` };
    return { ok: true, id: json.id };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "network error" };
  }
}
