import type { Metadata } from "next";
import { Mail } from "lucide-react";

export const metadata: Metadata = { title: "Contact" };

const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@rankora.app";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Contact</h1>
      <p className="mt-3 text-muted">Questions about Rankora, partnerships or data providers? We&apos;d love to hear from you.</p>
      <a
        href={`mailto:${CONTACT_EMAIL}`}
        className="mt-8 inline-flex items-center gap-3 rounded-xl border border-line p-5 hover:border-brand/40"
      >
        <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand">
          <Mail className="size-5" aria-hidden />
        </span>
        <span>
          <span className="block text-sm font-semibold">Email us</span>
          <span className="block text-sm text-muted">{CONTACT_EMAIL}</span>
        </span>
      </a>
      <p className="mt-6 text-xs text-muted">
        A contact form will be added once a transactional email provider is configured, so messages are actually delivered.
      </p>
    </div>
  );
}
