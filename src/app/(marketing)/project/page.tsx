import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Project documentation",
  description: "How Rankora is built: frontend, backend, database, APIs, security, SEO crawler, authentication, data visualization and CRUD.",
};

type Topic = { id: string; title: string; summary: string; points: string[]; files: string[] };

const TOPICS: Topic[] = [
  {
    id: "frontend",
    title: "Frontend",
    summary: "Next.js 16 App Router with React 19 Server Components, TypeScript (strict) and Tailwind CSS 4.",
    points: [
      "Pages are Server Components by default: they read data on the server and send HTML, so no API keys or SQL ever reach the browser.",
      "Client Components only where interaction is needed: forms with pending states, charts, the audit progress runner, the sidebar.",
      "A small design system (Button, Card, Badge, Field, StatCard, ScoreRing, EmptyState) keeps every module consistent and accessible (labels, focus rings, aria attributes).",
      "Honest UI states everywhere: empty, loading, error, “Provider Not Connected”, “Planned”, and a purple Demo Data badge.",
      "Responsive layout (sidebar collapses on mobile) and print styles for reports.",
    ],
    files: ["src/app/", "src/components/ui/", "src/components/app/sidebar.tsx", "src/app/globals.css"],
  },
  {
    id: "backend",
    title: "Backend",
    summary: "Server-side code runs in the same Next.js app: Server Actions for mutations, Route Handlers for APIs, and service modules for business logic.",
    points: [
      "Server Actions (src/lib/actions) validate every input with Zod, check the user's role, rate-limit expensive work and then call a service.",
      "Services (crawler, audit, keywords, Google sync, content, competitors, backlinks, reports) are plain TypeScript modules that can also be run from scripts and tests.",
      "Long jobs (crawls, Google syncs, rank checks) are resumable “ticks” with claims and time budgets, driven by the open page or by cron endpoints.",
      "Pure logic (scoring, parsing, analysis, comparisons) is separated from I/O so it can be unit-tested with fixtures.",
    ],
    files: ["src/lib/actions/", "src/lib/audit/service.ts", "src/lib/crawler/engine.ts", "src/lib/google/sync.ts", "src/lib/reports/build.ts"],
  },
  {
    id: "database",
    title: "Database",
    summary: "PostgreSQL on Supabase: 43 tables in 13 ordered migrations, with row-level security on every table.",
    points: [
      "Multi-tenant: every row carries organization_id; composite foreign keys (website_id, organization_id) make it impossible to attach data to another tenant's website.",
      "Core chain: organizations → websites → crawl_jobs → crawl_pages / crawl_links → seo_audits → seo_checks; websites → seo_issues → seo_tasks.",
      "Search and traffic data (search_console_*, analytics_*) are stored per day with a source column (gsc / ga4 / demo).",
      "SQL functions aggregate large data sets in the database (page_explorer, gsc_breakdown, rank_distribution, task_stats) — they are SECURITY INVOKER, so RLS still applies.",
      "Triggers enforce rules the UI must not be trusted with: one owner minimum, assignee must be a member, one open task per issue, demo flag taken from the website.",
    ],
    files: ["supabase/migrations/", "docs/DATABASE.md", "src/lib/supabase/database.types.ts"],
  },
  {
    id: "apis",
    title: "APIs",
    summary: "Internal REST-style Route Handlers plus external provider APIs behind interfaces.",
    points: [
      "Own endpoints: crawl job status and ticks, integration sync, rank checks, CSV/JSON exports, report export, Google OAuth start/callback, and three cron endpoints protected by a shared secret.",
      "Every endpoint first resolves the resource as the signed-in user (RLS) — another tenant's ID returns 404 — and only then uses the service role for writes.",
      "External: Google Search Console API, GA4 Data and Admin APIs, PageSpeed Insights, DataForSEO (keywords, SERP, ranked keywords, backlinks) and optionally Anthropic Claude.",
      "Provider interfaces (KeywordProvider, RankProvider, DomainKeywordProvider, BacklinkProvider, AiProvider) let another vendor be plugged in without touching the UI.",
    ],
    files: ["src/app/api/", "src/lib/providers/types.ts", "src/lib/google/", "src/lib/ai/"],
  },
  {
    id: "security",
    title: "Security",
    summary: "Defence in depth: proxy redirect, data access layer, row-level security, column grants and server-only secrets.",
    points: [
      "Authorization in three layers: src/proxy.ts (signed-out users), the DAL (requireOrg / requireWebsite with minimum role) and Postgres RLS on every table.",
      "Column-level grants stop clients from writing provider metrics, rankings, crawl results, scores, tokens or the demo flag.",
      "SSRF protection for every user-supplied URL: http/https only, private/loopback/metadata ranges blocked at every DNS lookup and redirect.",
      "OAuth with PKCE and hashed single-use state; tokens encrypted with AES-256-GCM; secrets only in server environment variables.",
      "Rate limits and monthly quotas on expensive operations; CSV exports neutralise spreadsheet formula injection; security headers set in next.config.ts.",
    ],
    files: ["src/proxy.ts", "src/lib/auth/dal.ts", "src/lib/security/", "docs/SECURITY.md"],
  },
  {
    id: "crawler",
    title: "SEO crawler",
    summary: "A server-side, polite, SSRF-safe crawler that feeds a transparent 33-rule audit.",
    points: [
      "Discovery from the start URL, robots.txt and XML sitemaps; same-site links only; page, depth, size and time limits.",
      "Each page is fetched with redirects followed manually (max 5), parsed with Cheerio for title, meta, headings, canonical, robots, links, images, structured data and Open Graph.",
      "The crawl frontier lives in the database (crawl_pages.fetch_state), so a crawl survives restarts and runs in short ticks.",
      "After crawling: broken-link checks, optional PageSpeed Core Web Vitals, then 33 rules produce checks and issues; the score is a documented weighted formula.",
    ],
    files: ["src/lib/crawler/", "src/lib/audit/analyze.ts", "src/lib/seo/rules.ts", "docs/SEO-SCORING.md"],
  },
  {
    id: "auth",
    title: "Authentication",
    summary: "Supabase Auth with email/password, Google and GitHub sign-in, and secure cookie sessions.",
    points: [
      "Register, sign in, sign out, password reset (PKCE recovery link) and account settings.",
      "Sessions are HTTP-only cookies managed by @supabase/ssr and refreshed in the proxy; identity is verified with getClaims() (JWT signature check).",
      "Roles per organization: owner, admin, member, viewer — checked on the server for every page and action, and again by RLS.",
      "Post-login redirects accept relative paths only, to prevent open redirects.",
    ],
    files: ["src/app/(auth)/", "src/app/auth/callback/", "src/lib/supabase/", "src/lib/auth/"],
  },
  {
    id: "dataviz",
    title: "Data visualization",
    summary: "Recharts for time series and distributions, plus purpose-built score and progress components.",
    points: [
      "Trend charts for clicks/impressions and sessions/users, ranking distribution bars, keyword position history (reversed axis).",
      "Score ring and category bars for the SEO health score; progress bars for tasks; deltas coloured by whether up is good.",
      "Missing days are not drawn as zeros; every chart says where its data came from, and demo data carries the Demo Data badge.",
    ],
    files: ["src/components/charts/", "src/components/ui/score-ring.tsx", "src/components/analytics/controls.tsx"],
  },
  {
    id: "crud",
    title: "CRUD",
    summary: "Create, read, update and delete through validated Server Actions; RLS decides which rows each user can touch.",
    points: [
      "Organizations and websites: create, rename, edit settings, delete (owner/admin).",
      "Keywords and groups: create, import CSV, track/untrack, set target URL, delete; export CSV.",
      "Competitors: add, edit name/notes, remove. SEO tasks: create (manually or from issues), edit every field, change status on the board, delete.",
      "Issues: ignore/reopen. Content analyses and reports: create, view history, delete.",
      "Server-only data (crawl results, metrics, rankings, snapshots) is created by services, readable by members and never writable by clients.",
    ],
    files: ["src/lib/actions/", "src/lib/validation/schemas.ts", "tests/db/rls.test.ts"],
  },
];

export default function ProjectDocsPage() {
  return (
    <article className="mx-auto max-w-5xl px-4 py-14 sm:px-6">
      <p className="text-sm font-medium text-brand">Project documentation</p>
      <h1 className="mt-2 text-4xl font-semibold tracking-tight">How Rankora is built</h1>
      <p className="mt-4 max-w-3xl text-ink-2">
        A multi-tenant SEO platform built as a Web Development project and as a foundation for a commercial SaaS. This page summarises each part of the
        system for a viva or presentation. File paths point into the repository.
      </p>

      <div className="mt-8 grid gap-3 sm:grid-cols-4">
        {[
          ["43", "database tables"],
          ["69", "row-level security policies"],
          ["33", "SEO audit rules"],
          ["360+", "automated tests (incl. E2E)"],
        ].map(([n, l]) => (
          <div key={l} className="animate-fade-up hover-lift rounded-[var(--radius-card)] border border-line bg-surface p-4">
            <div className="text-3xl font-semibold text-ink">{n}</div>
            <div className="text-sm text-muted">{l}</div>
          </div>
        ))}
      </div>

      <nav aria-label="Topics" className="mt-8 flex flex-wrap gap-2 text-sm">
        {TOPICS.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="rounded-full border border-line-strong px-3 py-1 hover:bg-surface-2">
            {t.title}
          </a>
        ))}
      </nav>

      <section aria-labelledby="architecture" className="mt-10">
        <h2 id="architecture" className="text-2xl font-semibold">
          Architecture at a glance
        </h2>
        <figure data-reveal="zoom" className="mt-4 overflow-hidden rounded-2xl border border-line bg-[#0b1416] shadow-[var(--shadow-card)]">
          <a href="/architecture.svg" target="_blank" rel="noopener" title="Open the diagram full size">
            <Image
              src="/architecture.svg"
              alt="Rankora data flow: your website crawler, Google Search Console and GA4, PageSpeed Insights and DataForSEO feed the Rankora database (Supabase Postgres with row level security). Six modules — SEO audit, keyword research, rank tracker, analytics, competitors and backlinks, and the content optimizer — produce SEO tasks, which feed progress reports. A platform layer provides auth, organizations and roles, plans and usage limits, notifications and scheduled jobs; the app runs on Vercel with Supabase."
              width={1200}
              height={960}
              unoptimized
              priority
              className="h-auto w-full"
            />
          </a>
          <figcaption className="border-t border-line bg-surface px-4 py-3 text-xs text-muted">
            Product data flow — from data sources to tasks and reports. Click to open full size.
          </figcaption>
        </figure>
        <h3 className="mt-8 text-lg font-semibold">Request path</h3>
        <div className="mt-3 grid gap-3 text-sm md:grid-cols-[1fr_auto_1.4fr_auto_1fr] md:items-stretch">
          <div className="rounded-lg border border-line bg-surface p-4">
            <p className="font-semibold">Browser</p>
            <p className="mt-1 text-muted">HTML from Server Components, small Client Components for forms and charts. No secrets.</p>
          </div>
          <div className="hidden items-center text-muted md:flex" aria-hidden>
            →
          </div>
          <div className="rounded-lg border border-brand/30 bg-brand-soft/40 p-4">
            <p className="font-semibold">Next.js server (Vercel)</p>
            <ul className="mt-1 list-disc pl-4 text-muted">
              <li>proxy.ts — session refresh, redirects</li>
              <li>Pages + Server Actions — validate, authorize</li>
              <li>Route Handlers — exports, ticks, cron, OAuth</li>
              <li>Services — crawler, audit, sync, reports</li>
            </ul>
          </div>
          <div className="hidden items-center text-muted md:flex" aria-hidden>
            →
          </div>
          <div className="space-y-3">
            <div className="rounded-lg border border-line bg-surface p-4">
              <p className="font-semibold">Supabase</p>
              <p className="mt-1 text-muted">Postgres + RLS, Auth, SQL functions</p>
            </div>
            <div className="rounded-lg border border-line bg-surface p-4">
              <p className="font-semibold">External APIs</p>
              <p className="mt-1 text-muted">Google GSC / GA4 / PageSpeed, DataForSEO, Claude (optional), crawled websites</p>
            </div>
          </div>
        </div>
      </section>

      {TOPICS.map((t) => (
        <section key={t.id} id={t.id} aria-labelledby={`${t.id}-h`} data-reveal="blur" className="mt-10 scroll-mt-24 border-t border-line pt-8">
          <h2 id={`${t.id}-h`} className="text-2xl font-semibold">
            {t.title}
          </h2>
          <p className="mt-2 text-ink-2">{t.summary}</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-ink-2">
            {t.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-4 flex flex-wrap gap-2 text-xs">
            {t.files.map((f) => (
              <code key={f} className="rounded bg-surface-2 px-2 py-0.5 text-ink-2">
                {f}
              </code>
            ))}
          </p>
        </section>
      ))}

      <section className="mt-12 rounded-[var(--radius-card)] border border-line bg-canvas p-6">
        <h2 className="text-xl font-semibold">Presenting Rankora?</h2>
        <p className="mt-2 text-sm text-ink-2">
          Follow the 5–10 minute <Link href="/academic-demo" className="text-brand hover:underline">Academic Demo flow</Link>. Full details live in the
          repository under <code>docs/</code> (ARCHITECTURE, DATABASE, SECURITY, SEO-SCORING, INTEGRATIONS, PROJECT-DOCUMENTATION).
        </p>
      </section>
    </article>
  );
}
