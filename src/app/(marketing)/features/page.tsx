import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bell,
  Bookmark,
  CheckCircle2,
  CreditCard,
  Database,
  FileBarChart,
  FileText,
  FlaskConical,
  Globe,
  LayoutDashboard,
  LineChart,
  Link2,
  ListChecks,
  Lock,
  PenLine,
  Plug,
  ScanSearch,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  Sparkles,
  Swords,
  TrendingUp,
  UserRound,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Reveal } from "@/components/motion/reveal";
import { SITE_MODULES, type SiteModule } from "@/lib/navigation";
import { MARKETING_FEATURES } from "../features-data";

export const metadata: Metadata = {
  title: "Features",
  description:
    "Site audits, technical SEO, content optimization, keyword research, rank tracking, Search Console and GA4, competitors, backlinks, tasks and reports in one SEO workspace.",
};

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard, BarChart3, TrendingUp, Search, Bookmark, LineChart, Swords, Link2, ScanSearch, Wrench, FileText, PenLine, ListChecks, FileBarChart, Plug, Settings2,
};

const FLAGSHIP_ICONS: Record<string, LucideIcon> = {
  "seo-audit": ScanSearch,
  "keyword-research": Search,
  analytics: BarChart3,
  "rank-tracking": LineChart,
};

/** What a module needs before it shows live data. Everything else works right after adding a website. */
type Requirement = "ready" | "google" | "provider";
const REQUIREMENT: Partial<Record<string, Requirement>> = {
  analytics: "google",
  "search-performance": "google",
  "keyword-research": "provider",
  "rank-tracker": "provider",
  backlinks: "provider",
};
const REQUIREMENT_LABEL: Record<Requirement, { text: string; className: string }> = {
  ready: { text: "Works out of the box", className: "bg-success/10 text-success" },
  google: { text: "Connect Google", className: "bg-brand/10 text-brand" },
  provider: { text: "Needs a data provider", className: "bg-warning/10 text-warning" },
};

const GROUPS: { name: SiteModule["group"]; blurb: string }[] = [
  { name: "Overview", blurb: "See how the site is doing" },
  { name: "Research", blurb: "Find opportunities" },
  { name: "Optimize", blurb: "Fix and improve pages" },
  { name: "Manage", blurb: "Work as a team and report" },
];

const HIGHLIGHTS = [
  { value: "33", label: "documented audit rules" },
  { value: "21", label: "content checks" },
  { value: "16", label: "modules per website" },
  { value: "6", label: "report types" },
];

const TEAM = [
  { icon: Users, title: "Teams & roles", body: "Invite teammates as owner, admin, member or viewer. One-time invitation links, role changes and removal." },
  { icon: ListChecks, title: "Assignments", body: "Assign SEO tasks with priority and due dates; assignees are notified and progress shows on the dashboard." },
  { icon: Bell, title: "Notifications", body: "In-app alerts for assigned tasks, finished audits, new members, plan changes and usage limits." },
  { icon: Activity, title: "Activity log", body: "Who changed what and when: websites, members, invitations, integrations, plans and AI use." },
  { icon: CreditCard, title: "Plans & usage", body: "Free, Starter, Pro and Agency plans with usage meters for websites, pages, keywords, reports and AI credits." },
  { icon: Globe, title: "Many websites", body: "Manage several websites per organization and switch between organizations in one click." },
  { icon: UserRound, title: "Profile & sign-in", body: "Email and password, Google or GitHub sign-in, and a profile page showing your sign-in methods." },
  { icon: FlaskConical, title: "Demo Project", body: "A complete sample workspace for presentations, with every number labelled Demo Data." },
] as const;

const SOURCES = [
  { icon: ScanSearch, title: "Your own crawl", body: "Audit, technical SEO, page and content data come from Rankora's crawler reading your live pages." },
  { icon: TrendingUp, title: "Google", body: "Search Console and GA4 through read-only OAuth, and Core Web Vitals from PageSpeed Insights." },
  { icon: Database, title: "SEO data provider", body: "Keyword volumes, rankings and backlinks from a connected provider such as DataForSEO." },
  { icon: Sparkles, title: "AI (optional)", body: "Title, meta and outline suggestions, always labelled and reviewed by you before use." },
] as const;

const TRUST = [
  { icon: Lock, text: "Each organization's data isolated with row-level security" },
  { icon: ShieldCheck, text: "Read-only access; Rankora never changes your website" },
  { icon: Shield, text: "SSRF-safe crawler that respects robots.txt" },
  { icon: CheckCircle2, text: "No invented numbers: missing data is shown as missing" },
] as const;

export default function FeaturesPage() {
  return (
    <div data-pointer className="relative overflow-hidden">
      <div className="hero-glow pointer-events-none absolute inset-x-0 top-0 h-[30rem] opacity-80" aria-hidden />
      <div className="cursor-glow" aria-hidden />

      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6">
        {/* hero */}
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand/10 px-3 py-1 text-xs font-semibold text-brand">
            <Sparkles className="size-3.5" aria-hidden /> Features
          </span>
          <h1 className="mt-4 text-4xl font-extrabold tracking-tight sm:text-5xl">
            Everything you need to <span className="text-gradient">grow organic traffic</span>
          </h1>
          <p className="mt-5 text-lg text-muted">
            Audit, research, optimise, track and report in one workspace, built around data you can verify.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <span data-magnetic>
              <ButtonLink href="/register">
                Start free <ArrowRight aria-hidden />
              </ButtonLink>
            </span>
            <ButtonLink href="/academic-demo" variant="secondary">
              See the demo
            </ButtonLink>
          </div>
        </div>

        <div data-reveal-children="zoom" className="mx-auto mt-12 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
          {HIGHLIGHTS.map((h) => (
            <div key={h.label} className="rounded-2xl border border-line bg-surface/70 p-4 text-center">
              <p className="text-3xl font-extrabold text-gradient">{h.value}</p>
              <p className="mt-1 text-xs text-muted">{h.label}</p>
            </div>
          ))}
        </div>

        {/* flagship features */}
        <div className="mt-24 space-y-16">
          {MARKETING_FEATURES.map((f, i) => {
            const Icon = FLAGSHIP_ICONS[f.slug];
            const flip = i % 2 === 1;
            return (
              <div key={f.slug} className="grid items-center gap-8 lg:grid-cols-2 lg:gap-12">
                <Reveal variant={flip ? "right" : "left"} className={flip ? "lg:order-2" : undefined}>
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-brand">
                    <span className="grid size-8 place-items-center rounded-lg bg-brand/15">
                      <Icon className="size-4" aria-hidden />
                    </span>
                    {f.name}
                  </span>
                  <h2 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">{f.headline}</h2>
                  <p className="mt-3 text-muted">{f.intro}</p>
                  <p className="mt-4 flex gap-2 text-sm text-ink-2">
                    <ShieldCheck className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                    {f.dataNote}
                  </p>
                  <Link href={`/${f.slug}`} className="group mt-6 inline-flex items-center gap-1 text-sm font-semibold text-brand">
                    Learn more about {f.name} <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </Reveal>
                <Reveal variant={flip ? "left" : "right"} className={flip ? "lg:order-1" : undefined}>
                  <Card data-tilt className="glow-panel grid gap-3 p-5 sm:grid-cols-2 sm:p-6">
                    {f.points.map((p) => (
                      <div key={p.title} className="rounded-xl border border-line bg-canvas/40 p-4">
                        <p className="flex items-center gap-2 font-semibold text-ink">
                          <CheckCircle2 className="size-4 shrink-0 text-brand" aria-hidden />
                          {p.title}
                        </p>
                        <p className="mt-1 text-sm text-muted">{p.body}</p>
                      </div>
                    ))}
                  </Card>
                </Reveal>
              </div>
            );
          })}
        </div>

        {/* all modules */}
        <Reveal className="mt-28 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">All {SITE_MODULES.length} modules for every website</h2>
          <p className="mx-auto mt-2 max-w-2xl text-muted">
            Each module says what it needs. Most work as soon as you add a website; some show live data once Google or a data
            provider is connected.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2 text-xs font-medium">
            {(Object.keys(REQUIREMENT_LABEL) as Requirement[]).map((r) => (
              <span key={r} className={`rounded-full px-2.5 py-1 ${REQUIREMENT_LABEL[r].className}`}>
                {REQUIREMENT_LABEL[r].text}
              </span>
            ))}
          </div>
        </Reveal>
        <div className="mt-10 space-y-12">
          {GROUPS.map((g) => (
            <div key={g.name}>
              <Reveal variant="left" className="mb-4 flex items-baseline gap-3 border-b border-line pb-2">
                <h3 className="text-lg font-semibold text-ink">{g.name}</h3>
                <p className="text-sm text-muted">{g.blurb}</p>
              </Reveal>
              <div data-reveal-children="up" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {SITE_MODULES.filter((m) => m.group === g.name).map((m) => {
                  const Icon = ICONS[m.icon] ?? FileText;
                  const req = REQUIREMENT_LABEL[REQUIREMENT[m.slug] ?? "ready"];
                  return (
                    <div key={m.slug} data-spotlight className="flex flex-col rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-brand/40">
                      <span className="grid size-10 place-items-center rounded-lg bg-brand/15 text-brand">
                        <Icon className="size-5" aria-hidden />
                      </span>
                      <p className="mt-4 font-semibold text-ink">{m.label}</p>
                      <p className="mt-1 flex-1 text-sm text-muted">{m.summary}</p>
                      <span className={`mt-4 self-start rounded-full px-2 py-0.5 text-[11px] font-medium ${req.className}`}>{req.text}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* team & business */}
        <Reveal className="mt-28 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for teams and agencies</h2>
          <p className="mt-2 text-muted">Organization features that work across all your websites.</p>
        </Reveal>
        <div data-reveal-children="flip" className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TEAM.map((t) => (
            <Card key={t.title} className="p-5">
              <t.icon className="size-5 text-brand" aria-hidden />
              <p className="mt-3 font-semibold text-ink">{t.title}</p>
              <p className="mt-1 text-sm text-muted">{t.body}</p>
            </Card>
          ))}
        </div>

        {/* data sources */}
        <div className="mt-28 grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <Reveal variant="left">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Every number has a source</h2>
            <p className="mt-3 text-muted">
              Rankora never fills gaps with estimates. When a source is not connected, the module says so and explains how to
              connect it. Sample data appears only in the Demo Project, labelled <span className="font-semibold text-demo">Demo Data</span>.
            </p>
            <ul className="mt-6 space-y-3">
              {TRUST.map((t) => (
                <li key={t.text} className="flex gap-3 text-sm text-ink-2">
                  <t.icon className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  {t.text}
                </li>
              ))}
            </ul>
          </Reveal>
          <div data-reveal-children="right" className="grid gap-4 sm:grid-cols-2">
            {SOURCES.map((s) => (
              <Card key={s.title} className="p-5">
                <span className="grid size-10 place-items-center rounded-lg bg-brand/15 text-brand">
                  <s.icon className="size-5" aria-hidden />
                </span>
                <p className="mt-4 font-semibold text-ink">{s.title}</p>
                <p className="mt-1 text-sm text-muted">{s.body}</p>
              </Card>
            ))}
          </div>
        </div>

        {/* cta */}
        <Reveal variant="zoom" className="mt-28">
          <Card className="glow-panel px-6 py-12 text-center sm:px-12">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Run your first audit in minutes</h2>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Add a website, run an audit and get a prioritised list of fixes. Free for one website, no card required.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <span data-magnetic>
                <ButtonLink href="/register">
                  Create your free account <ArrowRight aria-hidden />
                </ButtonLink>
              </span>
              <ButtonLink href="/pricing" variant="secondary">
                Compare plans
              </ButtonLink>
            </div>
          </Card>
        </Reveal>
      </div>
    </div>
  );
}
