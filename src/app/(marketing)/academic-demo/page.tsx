import type { Metadata } from "next";
import Link from "next/link";
import { FlaskConical } from "lucide-react";
import { DemoDataBadge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Academic demo",
  description: "A 5–10 minute presentation flow for Rankora: problem, solution, architecture, live audit, keywords, integrations, database, security and business model.",
};

type Step = { n: number; title: string; time: string; say: string; show: string; where?: { href: string; label: string }[]; demo?: boolean };

const STEPS: Step[] = [
  {
    n: 1,
    title: "Problem statement",
    time: "0:30",
    say: "Small teams juggle five SEO tools, pay for each, and many dashboards show estimated or invented numbers. It is hard to know what to fix first and to prove progress.",
    show: "The landing page headline and the data-honesty note in the footer.",
    where: [{ href: "/", label: "Landing page" }],
  },
  {
    n: 2,
    title: "Solution",
    time: "0:30",
    say: "Rankora puts audit, keywords, rankings, Search Console, GA4, content optimization, competitors, tasks and reports in one workspace — and every number shows its source.",
    show: "Features page; mention the rule: data comes from a crawl, a connected provider, or is labelled Demo Data.",
    where: [{ href: "/features", label: "Features" }],
  },
  {
    n: 3,
    title: "Architecture",
    time: "1:00",
    say: "Next.js 16 server renders pages and runs Server Actions; Supabase Postgres stores everything behind row-level security; external APIs sit behind provider interfaces.",
    show: "The architecture diagram on the project page.",
    where: [{ href: "/project#architecture", label: "Architecture diagram" }],
  },
  {
    n: 4,
    title: "Registration / login",
    time: "0:45",
    say: "Supabase Auth with email/password plus Google and GitHub; secure cookie sessions; passwords never touch our code.",
    show: "Register, then the onboarding step that creates an organization (slug validation). Optionally show sign-in with Google.",
    where: [
      { href: "/register", label: "Register" },
      { href: "/login", label: "Sign in" },
    ],
  },
  {
    n: 5,
    title: "Add website",
    time: "0:30",
    say: "Each organization can hold several websites; the URL is validated against SSRF before anything is fetched.",
    show: "Onboarding → website. Type http://localhost first to show the rejection, then a real domain you own.",
  },
  {
    n: 6,
    title: "Run SEO audit",
    time: "1:00",
    say: "The crawler reads robots.txt and sitemaps, follows internal links within limits and runs 33 documented rules.",
    show: "Site Audit → Run audit; watch the live progress (discovery, crawling, link check, analyzing).",
  },
  {
    n: 7,
    title: "Show real audit results",
    time: "1:00",
    say: "The score is a weighted formula, not a black box. Every issue explains why it matters, how to fix it, and lists affected pages.",
    show: "Score ring and category bars → a critical issue → affected page → Create task. Then Page Explorer and Technical SEO.",
  },
  {
    n: 8,
    title: "Add keywords",
    time: "0:45",
    say: "Keywords can be added, imported from CSV, grouped and tracked. Without a data provider the app says “Provider Not Connected” instead of inventing volumes.",
    show: "Saved Keywords: add two keywords, set a target URL. Then switch to the Demo Project for the Rank Tracker chart.",
    demo: true,
  },
  {
    n: 9,
    title: "Analytics / Search Console integration",
    time: "1:00",
    say: "Google OAuth with PKCE and read-only scopes; tokens encrypted with AES-256-GCM; a resumable sync imports daily data with a source label.",
    show: "Integrations page states, then Search Performance and Analytics in the Demo Project (every card carries Demo Data).",
    demo: true,
  },
  {
    n: 10,
    title: "Database relationships",
    time: "0:45",
    say: "43 tables; organization_id on every row; composite foreign keys bind child rows to their website's organization.",
    show: "The relationship diagram on this page, or docs/DATABASE.md.",
    where: [{ href: "#database", label: "Relationship diagram" }],
  },
  {
    n: 11,
    title: "Security",
    time: "1:00",
    say: "Three layers: proxy, server-side role checks, and Postgres RLS. Clients cannot write metrics or scores. Every fetched URL is SSRF-checked.",
    show: "Run npm run test:db and open one RLS test (another tenant reads nothing).",
    where: [{ href: "/project#security", label: "Security summary" }],
  },
  {
    n: 12,
    title: "Future SaaS business model",
    time: "0:45",
    say: "Free tier for one site, paid plans for more websites, pages per audit and tracked keywords. Provider costs are metered per organization, and agencies could later get white-label reports (planned).",
    show: "Pricing page and plan limits enforced on the server (try 5,000 pages on Free). Finish on a Monthly SEO Summary report printed to PDF.",
    where: [{ href: "/pricing", label: "Pricing" }],
  },
];

const RELATIONS: [string, string, string][] = [
  ["auth.users", "1 : 1", "profiles"],
  ["auth.users", "n : m", "organizations (via organization_members.role)"],
  ["organizations", "1 : n", "websites"],
  ["websites", "1 : n", "crawl_jobs → crawl_pages → crawl_links"],
  ["crawl_jobs", "1 : 1", "seo_audits → seo_checks"],
  ["websites", "1 : n", "seo_issues → seo_issue_pages, seo_tasks"],
  ["websites", "1 : n", "keywords → keyword_rankings; keyword_groups (n : m)"],
  ["organizations", "1 : n", "oauth_connections → integrations → websites"],
  ["websites", "1 : n", "search_console_* / analytics_* (daily, source-labelled)"],
  ["websites", "1 : n", "competitors → competitor_rankings / competitor_snapshots"],
  ["websites", "1 : n", "backlinks, content_analyses, reports"],
];

export default function AcademicDemoPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <p className="text-sm font-medium text-brand">Academic Demo Mode</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">Presenting Rankora in 5–10 minutes</h1>
      <p className="mt-4 max-w-3xl text-ink-2">
        Twelve short steps for a viva or class presentation. Steps 1–7 use your own account and a real website. Steps 8–9 use the Demo Project, where every
        number is sample data and visibly marked.
      </p>

      <div role="note" className="mt-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-demo/25 bg-demo-soft p-4 text-sm text-demo">
        <FlaskConical className="size-5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">
          <strong>About demo data.</strong> The Demo Project is a separate, read-only workspace. A purple banner sits on every page and every metric carries the
          badge shown here. Say clearly that these numbers are samples.
        </span>
        <DemoDataBadge />
      </div>

      <div className="mt-6 rounded-[var(--radius-card)] border border-line bg-canvas p-4 text-sm text-ink-2">
        <p className="font-semibold text-ink">Before you start (2 minutes)</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Sign in and open the Demo Project once (onboarding → “Open Demo Project”), so both workspaces are in the organization switcher.</li>
          <li>Run an audit on your own website in advance, in case the network is slow. Use a site you own or one that allows crawling.</li>
          <li>Open a terminal in the project folder for the security step (<code>npm run test:db</code>).</li>
        </ol>
      </div>

      <ol data-reveal-children="left" className="mt-10 space-y-4">
        {STEPS.map((s) => (
          <li key={s.n} data-spotlight className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-brand text-sm font-semibold text-on-brand">{s.n}</span>
              <h2 className="text-lg font-semibold">{s.title}</h2>
              {s.demo && <DemoDataBadge />}
              <span className="ml-auto text-xs text-muted">≈ {s.time}</span>
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[5rem_1fr]">
              <dt className="font-medium text-muted">Say</dt>
              <dd className="text-ink-2">{s.say}</dd>
              <dt className="font-medium text-muted">Show</dt>
              <dd className="text-ink-2">{s.show}</dd>
            </dl>
            {s.where && (
              <p className="mt-3 flex flex-wrap gap-2 text-sm">
                {s.where.map((w) => (
                  <Link key={w.href} href={w.href} className="rounded-lg border border-line-strong px-3 py-1 hover:bg-surface-2">
                    {w.label} →
                  </Link>
                ))}
              </p>
            )}
          </li>
        ))}
      </ol>

      <section id="database" className="mt-12 scroll-mt-24">
        <h2 className="text-2xl font-semibold">Database relationships</h2>
        <p className="mt-2 text-sm text-ink-2">Every tenant table also carries organization_id, and row-level security lets a user see only their own organizations.</p>
        <div data-reveal="zoom" className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-line">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {RELATIONS.map(([a, card, b]) => (
                <tr key={a + b}>
                  <td className="px-4 py-2 font-medium text-ink">{a}</td>
                  <td className="px-4 py-2 text-center text-xs text-muted">{card}</td>
                  <td className="px-4 py-2 text-ink-2">{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-12 rounded-[var(--radius-card)] border border-line bg-canvas p-6 text-sm">
        <h2 className="text-xl font-semibold">Likely viva questions</h2>
        <dl className="mt-3 space-y-3 text-ink-2">
          <div>
            <dt className="font-medium text-ink">Where do the numbers come from?</dt>
            <dd>From your crawl, a connected provider (Google, DataForSEO) or the labelled Demo Project. Missing data is shown as missing.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">How do you stop one customer seeing another&apos;s data?</dt>
            <dd>Row-level security on all 43 tables, server-side role checks, and composite foreign keys; covered by database tests.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Can the crawler be abused to reach internal servers?</dt>
            <dd>No: every DNS answer and redirect is checked; private, loopback and cloud-metadata addresses are refused.</dd>
          </div>
          <div>
            <dt className="font-medium text-ink">Is the AI writing to my website?</dt>
            <dd>No. AI output is optional, labelled “AI suggestion”, stored for review and never published.</dd>
          </div>
        </dl>
        <p className="mt-4">
          Full technical write-up: <Link href="/project" className="text-brand hover:underline">project documentation</Link>.
        </p>
      </section>
    </article>
  );
}
