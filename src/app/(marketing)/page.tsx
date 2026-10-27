import Link from "next/link";
import { ArrowRight, ChevronDown, BarChart3, FileBarChart, KeyRound, LineChart, ListChecks, PenLine, ScanSearch, ShieldCheck, Sparkles, Swords } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Badge, SeverityBadge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";
import { HeroAuditForm } from "@/components/marketing/hero-audit-form";
import { Reveal } from "@/components/motion/reveal";

const MODULES = [
  { icon: ScanSearch, title: "Site Audit", body: "A real crawler checks 33 technical and on-page rules and explains every point of the score.", href: "/seo-audit" },
  { icon: KeyRound, title: "Keyword Research", body: "Related, long-tail and question keywords with volumes from a connected data provider.", href: "/keyword-research" },
  { icon: LineChart, title: "Rank Tracking", body: "Daily positions by country and device, with history and competitor positions from the same SERP.", href: "/rank-tracking" },
  { icon: BarChart3, title: "Search Console & GA4", body: "Clicks, impressions, queries, pages and organic traffic from your own Google accounts.", href: "/analytics" },
  { icon: PenLine, title: "Content Optimizer", body: "Score a page or draft against a keyword, with optional AI suggestions you review first.", href: "/features" },
  { icon: Swords, title: "Competitors", body: "Keyword overlap and gaps, homepage and page-by-page comparisons.", href: "/features" },
  { icon: ListChecks, title: "SEO Tasks", body: "Turn issues into assigned, tracked work for your team.", href: "/features" },
  { icon: FileBarChart, title: "Reports", body: "Monthly and on-demand reports with period comparison, ready to print.", href: "/features" },
];

// Product facts (not usage claims): each number is verifiable in the code or docs.
const FACTS = [
  ["33", "documented audit rules"],
  ["6", "report types with comparison"],
  ["100%", "read-only Google access"],
  ["0", "invented metrics"],
];

const FAQ = [
  ["Is there a free plan?", "Yes. The Free plan includes one website, monthly crawls, keyword tracking, Search Console and GA4, and reports. No card is required."],
  ["Will Rankora change my website?", "No. Rankora only reads: it crawls public pages and uses read-only Google access. AI suggestions are drafts for you to review and are never published."],
  ["Where do the numbers come from?", "From a real crawl of your site, your own Google Search Console and GA4, or a connected data provider. When a source is missing, Rankora says so instead of estimating."],
  ["Can my team work together?", "Yes. Invite teammates as admin, member or viewer, assign SEO tasks and follow progress on the dashboard."],
  ["Is my data secure?", "Each organization's data is isolated in the database with row-level security, OAuth tokens are encrypted, and the crawler blocks private network addresses."],
];

const STEPS = [
  ["Add your website", "Create a free workspace and enter your domain. We validate it and respect robots.txt."],
  ["Run the audit & connect Google", "Get a scored audit in minutes. Connect Search Console and GA4 with read-only access."],
  ["Fix, track, report", "Work through prioritised tasks, track rankings and share reports that prove progress."],
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative mx-auto max-w-6xl px-4 pb-20 pt-20 text-center sm:px-6 sm:pt-28">
          <span className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-brand/30 bg-brand-soft px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink">
            <Sparkles className="animate-float size-3.5" aria-hidden /> All-in-one SEO platform
          </span>
          <h1 className="animate-fade-up delay-1 mx-auto mt-7 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Analyze, fix and grow your <span className="text-gradient">search traffic</span>
          </h1>
          <p className="animate-fade-up delay-2 mx-auto mt-6 max-w-2xl text-lg text-ink-2 sm:text-xl">
            Rankora audits your website, connects Search Console and GA4, tracks your rankings and turns every finding into a clear, explainable action.
          </p>
          <div className="animate-fade-up delay-3">
            <HeroAuditForm />
          </div>
          <p className="animate-fade-up delay-4 mt-6 flex items-center justify-center gap-2 text-sm text-muted">
            <ShieldCheck className="size-4 text-brand" aria-hidden /> Free plan · No card required · Read-only Google access
          </p>
        </div>

        {/* Product preview — illustrative sample, labelled as such */}
        <figure className="animate-scale-in delay-4 relative mx-auto max-w-5xl px-4 pb-24 sm:px-6">
          <div className="rounded-3xl border border-line bg-surface/80 p-2 shadow-[0_30px_80px_-20px_var(--glow)] backdrop-blur">
            <div className="grid gap-2 md:grid-cols-[1fr_1.4fr]">
              <div className="rounded-2xl bg-canvas/60 p-6">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-ink">SEO health</p>
                  <Badge tone="demo">Sample preview</Badge>
                </div>
                <div className="mt-5 flex items-center gap-6">
                  <ScoreRing score={78} size={112} />
                  <ul className="flex-1 space-y-2 text-sm text-ink-2">
                    {(
                      [
                        ["critical", "3 rules"],
                        ["warning", "7 rules"],
                        ["opportunity", "5 rules"],
                        ["passed", "18 rules"],
                      ] as const
                    ).map(([sev, n]) => (
                      <li key={sev} className="flex items-center justify-between">
                        <SeverityBadge severity={sev} /> <span className="tabular">{n}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="rounded-2xl bg-canvas/60 p-6">
                <p className="text-sm font-semibold text-ink">Top issues to fix</p>
                <div className="mt-4 space-y-3 text-sm">
                  {[
                    ["critical", "Broken internal links", "12 pages"],
                    ["warning", "Duplicate title tags", "8 pages"],
                    ["warning", "Slow server response", "5 pages"],
                    ["opportunity", "Missing structured data", "31 pages"],
                  ].map(([sev, t, n]) => (
                    <div key={t} className="flex items-center gap-3 rounded-xl border border-line/70 bg-surface/60 px-3 py-2.5">
                      <SeverityBadge severity={sev as "critical"} />
                      <span className="flex-1 truncate text-ink-2">{t}</span>
                      <span className="tabular text-xs text-muted">{n}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <figcaption className="mt-3 text-center text-xs text-muted">Illustration with sample values.</figcaption>
        </figure>

        <Reveal className="relative mx-auto max-w-5xl px-4 pb-20 sm:px-6">
          <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-line bg-surface/50 md:grid-cols-4">
            {FACTS.map(([n, l]) => (
              <div key={l} className="border-line px-6 py-6 text-center [&:not(:last-child)]:border-r max-md:[&:nth-child(2)]:border-r-0 max-md:[&:nth-child(-n+2)]:border-b">
                <dt className="sr-only">{l}</dt>
                <dd>
                  <span className="text-gradient block font-[family-name:var(--font-display)] text-4xl font-extrabold">{n}</span>
                  <span className="mt-1 block text-sm text-muted">{l}</span>
                </dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      <section className="border-t border-line/70">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <Reveal>
            <p className="text-center text-xs font-semibold uppercase tracking-[0.18em] text-brand">Everything in one workspace</p>
            <h2 className="mx-auto mt-3 max-w-2xl text-center text-4xl font-bold tracking-tight text-ink">One platform instead of five SEO tools</h2>
          </Reveal>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <Reveal key={m.title}>
              <Link
                href={m.href}
                className="hover-lift group block h-full rounded-2xl border border-line bg-surface/60 p-6 hover:border-brand/40 hover:shadow-[0_0_40px_var(--glow)]"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-brand transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3">
                  <m.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-5 font-semibold text-ink">{m.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{m.body}</p>
              </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-line/70 bg-surface/40">
        <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6">
          <Reveal>
            <h2 className="text-center text-4xl font-bold tracking-tight text-ink">From URL to results in three steps</h2>
          </Reveal>
          <ol className="mt-14 grid gap-6 md:grid-cols-3">
            {STEPS.map(([t, b], i) => (
              <Reveal as="li" key={t} className="hover-lift relative rounded-2xl border border-line bg-surface p-7 hover:border-brand/40">
                <span className="font-[family-name:var(--font-display)] text-5xl font-extrabold text-brand/25">0{i + 1}</span>
                <h3 className="mt-3 text-lg font-semibold text-ink">{t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
              </Reveal>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-line/70">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-24 sm:px-6 md:grid-cols-3">
          {[
            ["Explainable scoring", "Every point of the SEO score traces back to a rule, a weight and the pages that failed it."],
            ["Honest data", "No invented search volumes, backlinks or traffic. Every metric shows its source, and sample data is labelled."],
            ["Secure by design", "Row-level security per organization, encrypted OAuth tokens and an SSRF-hardened crawler."],
          ].map(([t, b]) => (
            <Reveal key={t} className="hover-lift rounded-2xl border border-line bg-surface/60 p-7 hover:border-brand/40">
              <ShieldCheck className="size-5 text-brand" aria-hidden />
              <h3 className="mt-4 font-semibold text-ink">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{b}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="border-t border-line/70 bg-surface/40">
        <div className="mx-auto max-w-3xl px-4 py-24 sm:px-6">
          <Reveal>
            <h2 className="text-center text-4xl font-bold tracking-tight text-ink">Questions, answered</h2>
          </Reveal>
          <div className="mt-12 space-y-3">
            {FAQ.map(([q, a]) => (
              <Reveal key={q}>
                <details className="group rounded-2xl border border-line bg-surface p-5 transition-colors open:border-brand/40 hover:border-brand/30">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <ChevronDown className="size-5 shrink-0 text-muted transition-transform duration-300 group-open:rotate-180 group-open:text-brand" aria-hidden />
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden border-t border-line/70">
        <div className="hero-glow pointer-events-none absolute inset-0" aria-hidden />
        <Reveal className="relative mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
          <h2 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">
            Run your first audit <span className="text-gradient">today</span>
          </h2>
          <p className="mt-4 text-lg text-ink-2">Create a workspace, add your website and get a baseline in minutes.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/register" size="lg">
              Get started free <ArrowRight aria-hidden />
            </ButtonLink>
            <ButtonLink href="/academic-demo" size="lg" variant="secondary">
              See the demo tour
            </ButtonLink>
          </div>
        </Reveal>
      </section>
    </>
  );
}
