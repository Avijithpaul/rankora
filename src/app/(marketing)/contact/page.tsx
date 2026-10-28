import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BookOpen, ChevronDown, CreditCard, GraduationCap, Handshake, Mail, MessageSquareText, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";
import { ContactForm, CopyEmailButton } from "@/components/marketing/contact-form";
import { contactEmailConfig } from "@/lib/env";

export const metadata: Metadata = {
  title: "Contact",
  description: "Contact the Rankora team about plans, product help, partnerships, the academic demo or security.",
};

const CONTACT_EMAIL = "avijith.paul136@gmail.com";

const mailto = (subject: string) => `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`[Rankora] ${subject}`)}`;

const TOPICS = [
  {
    icon: CreditCard,
    title: "Plans & billing",
    body: "Compare Free, Starter, Pro and Agency, or ask which plan fits your websites and keywords.",
    href: "/pricing",
    cta: "See pricing",
  },
  {
    icon: BookOpen,
    title: "Product help",
    body: "How audits are scored, how Google data is synced and how reports are built.",
    href: "/project",
    cta: "Read the docs",
  },
  {
    icon: GraduationCap,
    title: "Academic demo",
    body: "A guided walkthrough of every module with clearly labelled demo data.",
    href: "/academic-demo",
    cta: "Open the demo",
  },
  {
    icon: Handshake,
    title: "Partnerships & data",
    body: "Agencies, integrations and keyword, SERP or backlink data providers.",
    href: mailto("Partnership"),
    cta: "Email us",
  },
] as const;

const TIPS = [
  "The website address the question is about",
  "Your organization name in Rankora (if you have an account)",
  "What you expected to happen and what happened instead",
  "A screenshot, if something looks wrong",
];

const FAQ = [
  ["Is there a free plan?", "Yes. The Free plan includes one website, monthly crawls, keyword tracking, Search Console and GA4, and reports. No card is required."],
  ["Can Rankora change my website?", "No. Rankora only reads: it crawls public pages and uses read-only Google access. AI suggestions are drafts for you to review."],
  ["How do I report a security issue?", "Email us with the topic “Security report” and the steps to reproduce. Please do not post security issues publicly."],
] as const;

export default function ContactPage() {
  return (
    <div data-pointer className="relative overflow-hidden">
      <div className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[28rem] opacity-80" aria-hidden />
      <div className="cursor-glow" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <MessageSquareText className="size-3.5" aria-hidden /> Contact
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Let&apos;s talk about <span className="text-gradient">your search growth</span>
          </h1>
          <p className="mt-4 text-muted">
            Questions about Rankora, plans, partnerships or the academic project? Send us a message and a real person will reply.
          </p>
        </div>

        <div className="mt-12 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]">
          {/* direct contact */}
          <div className="space-y-6">
            <Card className="glow-panel p-6">
              <div className="flex items-start gap-4">
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand/15 text-brand">
                  <Mail className="size-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">Email</p>
                  <a href={mailto("Hello")} className="mt-0.5 block break-words text-base font-semibold text-brand hover:underline sm:text-lg">
                    {/* allow a line break only after the "@" on narrow screens */}
                    {CONTACT_EMAIL.split("@")[0]}@<wbr />
                    {CONTACT_EMAIL.split("@")[1]}
                  </a>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CopyEmailButton email={CONTACT_EMAIL} />
                    <a
                      href={mailto("Hello")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 transition-colors hover:border-brand/40 hover:text-ink"
                    >
                      Open email app <ArrowRight className="size-3.5" aria-hidden />
                    </a>
                  </div>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <p className="text-sm font-semibold text-ink">To help us answer faster, include</p>
              <ul className="mt-3 space-y-2 text-sm text-ink-2">
                {TIPS.map((t) => (
                  <li key={t} className="flex gap-2">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                    {t}
                  </li>
                ))}
              </ul>
            </Card>

            <Card className="p-6">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                <div>
                  <p className="text-sm font-semibold text-ink">Security</p>
                  <p className="mt-1 text-sm text-muted">
                    Found a vulnerability? Email us with the topic “Security report”. Please never send passwords or API keys by email.
                  </p>
                </div>
              </div>
            </Card>
          </div>

          {/* message composer */}
          <Card className="p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-ink">Send a message</h2>
            <p className="mt-1 text-sm text-muted">Pick a topic, write your message, and we&apos;ll get it in our inbox.</p>
            <div className="mt-6">
              <ContactForm email={CONTACT_EMAIL} directEmail={contactEmailConfig() !== null} />
            </div>
          </Card>
        </div>

        {/* topics */}
        <Reveal className="mt-20">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">How can we help?</h2>
          <p className="mt-2 text-center text-muted">Many answers are one click away.</p>
        </Reveal>
        <div data-reveal-children="flip" className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {TOPICS.map((t) => (
            <Link key={t.title} href={t.href} className="group hover-lift">
              <Card className="flex h-full flex-col p-5 group-hover:border-brand/40">
                <span className="grid size-10 place-items-center rounded-lg bg-brand/15 text-brand">
                  <t.icon className="size-5" aria-hidden />
                </span>
                <p className="mt-4 font-semibold text-ink">{t.title}</p>
                <p className="mt-1 flex-1 text-sm text-muted">{t.body}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                  {t.cta} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
              </Card>
            </Link>
          ))}
        </div>

        {/* faq */}
        <div className="mx-auto mt-20 max-w-3xl">
          <Reveal>
            <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">Quick answers</h2>
          </Reveal>
          <div className="mt-8 space-y-3">
            {FAQ.map(([q, a], i) => (
              <Reveal key={q} variant={i % 2 ? "right" : "left"}>
                <details className="group rounded-2xl border border-line bg-surface p-5 transition-colors open:border-brand/40 hover:border-brand/30">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown className="size-5 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180 group-open:text-brand" aria-hidden />
                  </summary>
                  <p className="mt-3 text-sm text-muted">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
