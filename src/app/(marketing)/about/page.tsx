import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Briefcase,
  Building2,
  Database,
  Eye,
  FileText,
  GraduationCap,
  Layers,
  ListChecks,
  Lock,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Target,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";

export const metadata: Metadata = {
  title: "About",
  description:
    "Why Rankora exists: one honest SEO workspace to analyse a website, fix what matters as a team, track results and report progress.",
};

const PROBLEMS = [
  "Five or six separate tools for audits, keywords, rankings, Search Console, analytics and tasks",
  "Dashboards full of estimated or invented numbers",
  "Long issue lists with no owner, no priority and no follow-up",
  "No simple way to prove progress to a client or a manager",
];

const SOLUTIONS = [
  "One workspace for audit, keywords, rankings, Google data, content, competitors, tasks and reports",
  "Every number shows its source: a crawl, a connected provider or labelled demo data",
  "Issues become assigned tasks with due dates and status",
  "Reports with date comparison you can print or export",
];

const CYCLE = [
  { icon: Search, title: "Analyse", body: "Crawl your site, score it against 33 documented SEO rules and measure Core Web Vitals.", href: "/seo-audit" },
  { icon: Wrench, title: "Fix", body: "Each issue explains why it matters and how to fix it, page by page. Turn issues into tasks for your team.", href: "/features" },
  { icon: Target, title: "Optimise", body: "Check pages and drafts against 21 content checks, organise keywords and compare with competitors.", href: "/keyword-research" },
  { icon: BarChart3, title: "Track", body: "Follow rankings and real Search Console and GA4 data over time, with period comparison.", href: "/rank-tracking" },
  { icon: FileText, title: "Report", body: "Generate client-ready reports, then print them or export CSV and JSON.", href: "/features" },
] as const;

const PRINCIPLES = [
  { icon: BadgeCheck, title: "No invented numbers", body: "If a data provider is not connected, Rankora says so instead of guessing. Demo data is always labelled Demo Data." },
  { icon: Eye, title: "Transparent scores", body: "The SEO score is a documented, weighted formula over stored rule checks, not a black box." },
  { icon: Lock, title: "Your data stays yours", body: "Each organization's data is isolated at the database level with row-level security on every table." },
  { icon: ShieldCheck, title: "Read-only by design", body: "Rankora reads public pages and uses read-only Google access. It never changes your website." },
  { icon: Sparkles, title: "AI as a helper", body: "Optional AI suggestions are clearly marked, and you review every one. Nothing is published automatically." },
  { icon: Users, title: "Built for teams", body: "Roles, invitations, assignments, notifications and an activity log keep everyone on the same page." },
] as const;

const AUDIENCE = [
  { icon: Store, title: "Website owners", body: "Find and fix what holds your site back, without hiring an expert. The Free plan covers one website." },
  { icon: Briefcase, title: "Freelancers", body: "Manage several client websites in one place and send reports that show the work you did." },
  { icon: Building2, title: "Agencies", body: "Owners, admins, members and viewers, task boards across many sites, usage limits and an audit trail." },
] as const;

const BUILT = [
  { icon: Layers, title: "Modern stack", body: "Next.js 16 and React 19 rendered on the server, TypeScript in strict mode, Tailwind CSS." },
  { icon: Database, title: "Postgres + RLS", body: "Supabase Postgres with row-level security, database-enforced plan limits and tenant isolation." },
  { icon: ShieldCheck, title: "Security first", body: "SSRF-safe crawling, PKCE OAuth with encrypted tokens, rate limits and strict security headers." },
  { icon: ListChecks, title: "Tested", body: "Unit, database and end-to-end browser tests run against the real migrations and a production build." },
] as const;

export default function AboutPage() {
  return (
    <div data-pointer className="relative overflow-hidden">
      <div className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[30rem] opacity-80" aria-hidden />
      <div className="cursor-glow" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {/* hero */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <Sparkles className="size-3.5" aria-hidden /> About Rankora
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            SEO you can trust, <span className="text-gradient">from audit to results</span>
          </h1>
          <p className="mt-5 text-lg text-muted">
            Rankora is one workspace to analyse a website, fix what matters as a team, track the results and report progress,
            with every number traceable to its source.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <span data-magnetic>
              <ButtonLink href="/register">
                Get started free <ArrowRight aria-hidden />
              </ButtonLink>
            </span>
            <ButtonLink href="/project" variant="secondary">
              See how it&apos;s built
            </ButtonLink>
          </div>
        </div>

        {/* why */}
        <Reveal className="mt-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Why we built Rankora</h2>
          <p className="mx-auto mt-2 max-w-2xl text-muted">
            Search traffic depends on a healthy site, good content and the right keywords, but the tools for it are scattered
            and often hard to trust.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Reveal variant="left">
            <Card className="h-full p-6 sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-wider text-critical">The problem</p>
              <ul className="mt-4 space-y-3">
                {PROBLEMS.map((p) => (
                  <li key={p} className="flex gap-3 text-ink-2">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-critical/10 text-critical">
                      <X className="size-3" aria-hidden />
                    </span>
                    {p}
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
          <Reveal variant="right">
            <Card className="glow-panel h-full p-6 sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-wider text-brand">The Rankora way</p>
              <ul className="mt-4 space-y-3">
                {SOLUTIONS.map((s) => (
                  <li key={s} className="flex gap-3 text-ink-2">
                    <BadgeCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
                    {s}
                  </li>
                ))}
              </ul>
            </Card>
          </Reveal>
        </div>

        {/* what it does */}
        <Reveal className="mt-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">The complete SEO cycle in one place</h2>
          <p className="mt-2 text-muted">Most tools stop at a list of problems. Rankora follows the work through to results.</p>
        </Reveal>
        <ol data-reveal-children="up" className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {CYCLE.map((c, i) => (
            <li key={c.title}>
              <Link href={c.href} className="group hover-lift block h-full">
                <Card className="flex h-full flex-col p-5 group-hover:border-brand/40">
                  <div className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-lg bg-brand/15 text-brand">
                      <c.icon className="size-5" aria-hidden />
                    </span>
                    <span className="text-xs font-bold text-muted">0{i + 1}</span>
                  </div>
                  <p className="mt-4 font-semibold text-ink">{c.title}</p>
                  <p className="mt-1 flex-1 text-sm text-muted">{c.body}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ol>

        {/* principles */}
        <Reveal className="mt-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">What we stand for</h2>
          <p className="mt-2 text-muted">The rules every feature in Rankora follows.</p>
        </Reveal>
        <div data-reveal-children="zoom" className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PRINCIPLES.map((p) => (
            <div key={p.title} data-spotlight className="rounded-2xl border border-line bg-surface p-6 transition-colors hover:border-brand/40">
              <p.icon className="size-6 text-brand" aria-hidden />
              <p className="mt-4 font-semibold text-ink">{p.title}</p>
              <p className="mt-1 text-sm text-muted">{p.body}</p>
            </div>
          ))}
        </div>

        {/* audience */}
        <Reveal className="mt-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Who Rankora is for</h2>
        </Reveal>
        <div data-reveal-children="flip" className="mt-10 grid gap-5 md:grid-cols-3">
          {AUDIENCE.map((a) => (
            <Card key={a.title} className="p-6">
              <span className="grid size-12 place-items-center rounded-xl bg-brand/15 text-brand">
                <a.icon className="size-6" aria-hidden />
              </span>
              <p className="mt-4 text-lg font-semibold text-ink">{a.title}</p>
              <p className="mt-1 text-sm text-muted">{a.body}</p>
            </Card>
          ))}
        </div>

        {/* how it's built */}
        <div className="mt-24 grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Reveal variant="left">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink-2">
              <GraduationCap className="size-3.5 text-brand" aria-hidden /> Academic project, production standards
            </span>
            <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">Built like a real SaaS</h2>
            <p className="mt-3 text-muted">
              Rankora started as a web development project and was engineered to the standard of a commercial product: multi-tenant
              organizations, roles, plans and usage limits, an admin console, a security review and automated tests.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <ButtonLink href="/project" variant="secondary">
                Architecture &amp; docs <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href="/academic-demo" variant="ghost">
                Academic demo
              </ButtonLink>
            </div>
          </Reveal>
          <div data-reveal-children="right" className="grid gap-4 sm:grid-cols-2">
            {BUILT.map((b) => (
              <Card key={b.title} className="p-5">
                <b.icon className="size-5 text-brand" aria-hidden />
                <p className="mt-3 font-semibold text-ink">{b.title}</p>
                <p className="mt-1 text-sm text-muted">{b.body}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* cta */}
        <Reveal variant="zoom" className="mt-24">
          <Card className="glow-panel relative overflow-hidden px-6 py-12 text-center sm:px-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Ready to see your site clearly?</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Start free with one website. No card required. Upgrade when you need more websites, pages or keywords.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <span data-magnetic>
                <ButtonLink href="/register">
                  Create your free account <ArrowRight aria-hidden />
                </ButtonLink>
              </span>
              <ButtonLink href="/contact" variant="secondary">
                Talk to us
              </ButtonLink>
            </div>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
