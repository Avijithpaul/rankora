"use client";

import { useState } from "react";
import { Check, Copy, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/form";

export const CONTACT_TOPICS = ["General question", "Plans & billing", "Product help", "Partnership or data provider", "Academic project / demo", "Security report"] as const;

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

/**
 * Composes the message in the visitor's own email app (mailto). Nothing is sent to or stored
 * on Rankora's servers; a server-side form needs a transactional email provider first.
 */
export function ContactForm({ email }: { email: string }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const name = String(data.get("name") ?? "").trim();
        const topic = String(data.get("topic") ?? CONTACT_TOPICS[0]);
        const message = String(data.get("message") ?? "").trim();
        if (message.length < 10) {
          setError("Please write a short message (at least 10 characters).");
          return;
        }
        setError(null);
        const subject = `[Rankora] ${topic}${name ? ` — ${name}` : ""}`;
        const body = `${message}\n\n—\n${name || "(no name given)"}`;
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Your name" htmlFor="contact-name">
          <Input id="contact-name" name="name" autoComplete="name" placeholder="Jane Doe" maxLength={80} />
        </Field>
        <Field label="Topic" htmlFor="contact-topic">
          <Select id="contact-topic" name="topic" defaultValue={CONTACT_TOPICS[0]}>
            {CONTACT_TOPICS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Message" htmlFor="contact-message" error={error ?? undefined}>
        <Textarea
          id="contact-message"
          name="message"
          rows={6}
          maxLength={4000}
          placeholder="Tell us what you need — include your website address if it is about a specific site."
          aria-invalid={error ? true : undefined}
        />
      </Field>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">Opens your email app with the message ready to send. Nothing is stored on our servers.</p>
        <Button type="submit" className="shrink-0">
          <Send className="size-4" aria-hidden /> Write email
        </Button>
      </div>
    </form>
  );
}
