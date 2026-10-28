"use client";

import { useActionState, useState } from "react";
import { Check, CheckCircle2, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { CONTACT_TOPICS } from "@/lib/contact";
import { sendContactMessageAction } from "@/lib/actions/contact";
import type { ActionState } from "@/lib/validation/schemas";

/** Copies the contact address; falls back to doing nothing visible if the clipboard is blocked. */
export function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(email);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard unavailable: the address is shown on the page */
        }
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
      aria-label={copied ? "Email address copied" : "Copy email address"}
    >
      {copied ? <Check className="size-3.5 text-success" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const firstError = (state: ActionState, key: string) => state.fieldErrors?.[key]?.[0];

/**
 * With `directEmail` the message is sent server-side through Resend (sendContactMessageAction).
 * Without it, the form composes the message in the visitor's own mail app (mailto) and nothing
 * is sent to or stored on Rankora's servers.
 */
export function ContactForm({ email, directEmail }: { email: string; directEmail: boolean }) {
  const [state, action, pending] = useActionState(sendContactMessageAction, { ok: false });
  const [clientError, setClientError] = useState<string | null>(null);

  if (directEmail && state.ok) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-xl border border-success/30 bg-success/10 px-6 py-10 text-center">
        <CheckCircle2 className="size-10 text-success" aria-hidden />
        <p className="text-lg font-semibold text-ink">Message sent</p>
        <p className="max-w-sm text-sm text-muted">{state.message}</p>
      </div>
    );
  }

  const v = state.values ?? {};
  return (
    <form
      className="space-y-4"
      action={directEmail ? action : undefined}
      onSubmit={
        directEmail
          ? undefined
          : (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const name = String(data.get("name") ?? "").trim();
              const topic = String(data.get("topic") ?? CONTACT_TOPICS[0]);
              const message = String(data.get("message") ?? "").trim();
              if (message.length < 10) {
                setClientError("Please write a short message (at least 10 characters).");
                return;
              }
              setClientError(null);
              const subject = `[Rankora] ${topic}${name ? ` — ${name}` : ""}`;
              const body = `${message}\n\n—\n${name || "(no name given)"}`;
              window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
            }
      }
    >
      {/* honeypot for bots; hidden from people and assistive tech */}
      <div aria-hidden className="absolute -left-[9999px] size-px overflow-hidden">
        <label>
          Company
          <input type="text" name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="contact-name" error={firstError(state, "name")}>
          <Input id="contact-name" name="name" autoComplete="name" placeholder="Jane Doe" maxLength={80} defaultValue={v.name} />
        </Field>
        {directEmail ? (
          <Field label="Your email" htmlFor="contact-email" error={firstError(state, "email")}>
            <Input id="contact-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required defaultValue={v.email} aria-invalid={firstError(state, "email") ? true : undefined} />
          </Field>
        ) : null}
        <Field label="Topic" htmlFor="contact-topic" className={directEmail ? "sm:col-span-2" : undefined} error={firstError(state, "topic")}>
          <Select id="contact-topic" name="topic" defaultValue={v.topic || CONTACT_TOPICS[0]}>
            {CONTACT_TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Message" htmlFor="contact-message" error={clientError ?? firstError(state, "message")}>
        <Textarea
          id="contact-message"
          name="message"
          rows={6}
          maxLength={4000}
          required={directEmail}
          defaultValue={v.message}
          placeholder="Tell us what you need — include your website address if it is about a specific site."
          aria-invalid={clientError || firstError(state, "message") ? true : undefined}
        />
      </Field>

      {directEmail && state.message && !state.ok ? (
        <p role="alert" className="rounded-lg border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical">
          {state.message}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">
          {directEmail
            ? "We only use your email to reply to this message."
            : "Opens your email app with the message ready to send. Nothing is stored on our servers."}
        </p>
        <Button type="submit" className="shrink-0" loading={pending}>
          {!pending && <Send className="size-4" aria-hidden />} {directEmail ? (pending ? "Sending…" : "Send message") : "Write email"}
        </Button>
      </div>
    </form>
  );
}
