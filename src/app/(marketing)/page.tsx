import Link from "next/link";
import { ArrowRight, BarChart3, FileBarChart, KeyRound, LineChart, ListChecks, ScanSearch, ShieldCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Badge, SeverityBadge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/ui/score-ring";

const MODULES = [
  { icon: ScanSearch, title: "Site Audit", body: "Crawl your site and check 30+ technical and on-page rules.", href: "/seo-audit" },
  { icon: KeyRound, title: "Keyword Research", body: "Related, long-tail and question keywords with provider metrics.", href: "/keyword-research" },
  { icon: LineChart, title: "Rank Tracking", body: "Daily positions by country and device, with full history.", href: "/rank-tracking" },
  { icon: BarChart3, title: "Analytics", body: "Search Console and GA4 data, normalised and comparable.", href: "/analytics" },
  { icon: ListChecks, title: "SEO Tasks", body: "Turn issues into assigned, trackable work.", href: "/features" },
  { icon: FileBarChart, title: "Reports", body: "Monthly and on-demand reports with period comparison.", href: "/features" },
];

export default function HomePage() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line bg-canvas">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:py-28">
          <div>
            <Badge tone="brand">All-in-One SEO Analyze, Fix &amp; Optimization Platform</Badge>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.1] tracking-tight text-ink sm:text-5xl">
              Find what&apos;s holding your site back. Fix it. Prove it worked.
            </h1>
            <p className="mt-5 max-w-xl text-lg text-muted">
              Rankora audits your website, connects your Google Search Console and Analytics data, tracks rankings and turns
              every finding into a prioritised, explainable action.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/register" size="lg">
                Start free <ArrowRight aria-hidden />
              </ButtonLink>
              <ButtonLink href="/features" size="lg" variant="secondary">
                Explore features
              </ButtonLink>
            </div>
            <p className="mt-4 flex items-center gap-2 text-sm text-muted">
              <ShieldCheck className="size-4 text-success" aria-hidden /> Read-only Google access · No card required
            </p>
          </div>

          {/* Product preview — illustrative sample, labelled as such */}
          <figure className="relative">
            <div className="rounded-2xl border border-line bg-surface p-5 shadow-xl shadow-ink/5">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">SEO health</p>
                <Badge tone="demo">Sample preview</Badge>
              </div>
              <div className="mt-4 flex items-center gap-6">
                <ScoreRing score={78} size={104} />
                <ul className="flex-1 space-y-2 text-sm">
                  <li className="flex items-center justify-between">
                    <SeverityBadge severity="critical" /> <span className="tabular">3 rules</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <SeverityBadge severity="warning" /> <span className="tabular">7 rules</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <SeverityBadge severity="opportunity" /> <span className="tabular">5 rules</span>
                  </li>
                  <li className="flex items-center justify-between">
                    <SeverityBadge severity="passed" /> <span className="tabular">18 rules</span>
                  </li>
                </ul>
              </div>
              <div className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
                {[
                  ["critical", "Broken internal links", "12 pages"],
                  ["warning", "Duplicate title tags", "8 pages"],
                  ["opportunity", "Missing structured data", "31 pages"],
                ].map(([sev, t, n]) => (
                  <div key={t} className="flex items-center gap-3">
                    <SeverityBadge severity={sev as "critical"} />
                    <span className="flex-1 truncate">{t}</span>
                    <span className="tabular text-xs text-muted">{n}</span>
                  </div>
                ))}
              </div>
            </div>
            <figcaption className="mt-3 text-center text-xs text-muted">Illustration with sample values.</figcaption>
          </figure>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight">Everything in one workspace</h2>
        <p className="mt-2 max-w-2xl text-muted">Manage multiple websites per organization, with team roles and per-site integrations.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MODULES.map((m) => (
            <Link key={m.title} href={m.href} className="group rounded-xl border border-line p-6 transition-colors hover:border-brand/40 hover:bg-brand-soft/30">
              <m.icon className="size-5 text-brand" aria-hidden />
              <h3 className="mt-4 font-semibold text-ink">{m.title}</h3>
              <p className="mt-1 text-sm text-muted">{m.body}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-sidebar text-sidebar-ink">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
          {[
            ["Explainable scoring", "Every point of the SEO score traces back to a rule, a weight and the pages that failed it."],
            ["Honest data", "No invented search volumes, backlinks or traffic. Every metric shows its source."],
            ["Secure by design", "Row-level security per organization, encrypted OAuth tokens and an SSRF-hardened crawler."],
          ].map(([t, b]) => (
            <div key={t}>
              <h3 className="font-semibold text-white">{t}</h3>
              <p className="mt-2 text-sm">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-3xl font-semibold tracking-tight">Run your first audit today</h2>
        <p className="mt-3 text-muted">Create an organization, add your website and get a baseline in minutes.</p>
        <ButtonLink href="/register" size="lg" className="mt-8">
          Create free account
        </ButtonLink>
      </section>
    </>
  );
}
