# Rankora

**All-in-One SEO Analyze, Fix & Optimization Platform**

Rankora is a multi-tenant SEO SaaS. Teams add their websites, run a real server-side crawl and
transparent SEO audit, research keywords, track Google rankings, and connect Google Search
Console and GA4 — all in one workspace. It is built both as a Web Development academic project and as
a foundation for a commercial product.

> **Data honesty.** Rankora never invents search volumes, rankings, backlinks or analytics. Metrics come
> from a connected provider, from a real crawl, or are shown in a clearly labelled **Demo Project**.
> When a provider is missing, the UI says **“Provider Not Connected”** instead of showing numbers.

---

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: auth, password reset, organizations & roles, websites, onboarding, app shell, dashboard, Demo Project, RLS | ✅ Done |
| 2 | Site Audit: SSRF-safe crawler, robots.txt, sitemaps, 33-rule analyzer, weighted score, issues, pages, Technical SEO | ✅ Done |
| 3 | Keywords: provider abstraction (DataForSEO), keyword research, saved keywords, groups, rank tracker, history, CSV | ✅ Done |
| 4 | Google Search Console & GA4: secure OAuth, property selection, sync, Analytics + Search Performance sections | ✅ Done |
| 5 | Page Explorer, Content Optimizer (URL or draft), optional labelled AI suggestions, analysis history | ✅ Done |
| 6 | Competitors (rankings, overlap/gaps, homepage & page comparison), backlink provider abstraction, SEO Tasks | ✅ Done |
| 7 | Reports (six types, comparison, print, JSON/CSV export, PDF architecture), Academic Demo Mode, project documentation | ✅ Done |
| 8 | SaaS readiness: plans & limits, subscriptions, billing abstraction, team invitations, notifications, admin monitoring, security review, E2E | ✅ Done |
| 9 | Launch: activate payments (with approval), email, MFA, monitoring | Planned |

Unbuilt modules are visible in the app with an explicit **“Planned · Phase N”** page — never placeholder numbers.
Details: [docs/PROGRESS.md](docs/PROGRESS.md) · [docs/ROADMAP.md](docs/ROADMAP.md).

## Features available now

- **Accounts & workspaces** — register, sign in/out, password reset, account settings; organizations with
  owner/admin/member/viewer roles; multiple websites per organization; plan limits enforced server-side.
- **Onboarding** — organization → website (country, language, preferred domain) → next steps, plus an optional Demo Project.
- **Dashboard** — SEO health score, issues, clicks, impressions, CTR, position, organic traffic/users with period
  comparison, trends, ranking distribution, top queries/pages, recommended actions (each with an honest empty state).
- **Site Audit** — real crawl with live progress; robots.txt & sitemap discovery; redirects, status codes, retries;
  33 documented rules; weighted score with category breakdown; issue list with explanation & fix, affected pages,
  ignore/reopen, detected/fixed dates; audit history; Pages explorer and page details; Technical SEO overview;
  Core Web Vitals via PageSpeed Insights (when an API key is configured).
- **Keywords** — keyword research (related, long-tail, questions, intent, clusters), saved keywords, groups, bulk
  actions, CSV import/export, keyword detail with ranking history, Rank Tracker (Top 3/10/20/100, improved,
  dropped, new, lost, distribution chart, daily checks).
- **Google integrations** — connect Search Console and GA4 with read-only OAuth, choose properties, automatic sync;
  Search Performance (overview, queries, pages, countries, devices) and Analytics (overview, traffic, pages,
  acquisition, countries, devices) with date ranges and comparison periods.
- **Page Explorer** — every crawled URL with Search Console clicks/impressions/position, GA4 views, open issues and mapped
  keywords; sortable; page details with 28-day comparisons and rule-based recommendations.
- **Content Optimizer** — analyze a page URL or a pasted draft for a target keyword: 21 explained checks (metadata, headings,
  placement, structure, length, links, related-term coverage from real sources, readability), weighted score, history,
  internal-link opportunities. Optional **AI suggestions** (titles, meta descriptions, outline, FAQs, improvements,
  internal links) via Claude, always labelled as suggestions and never published.
- **Competitors** — up to 10 competitor domains per website: positions from the same SERP as your daily rank check,
  keyword overlap and gaps from the provider's ranking index, like-for-like homepage SEO snapshot, page-vs-page content
  comparison.
- **Backlinks** — provider abstraction (DataForSEO Backlinks): backlinks, referring domains, anchor text, new and lost
  links; shows “Provider Not Connected” until enabled — never estimated.
- **SEO Tasks** — turn audit issues into tasks (one click or in bulk) with page, priority, status (To Do / In Progress /
  Completed / Ignored), assignee, due date, source issue and notes; board, filters and dashboard progress.
- **Reports** — SEO Overview, Site Audit, Keyword Rankings, Organic Traffic, Search Performance and Monthly SEO
  Summary for any website and date range, with period comparison; frozen snapshots, printable page, JSON/CSV export;
  every section names its data source.
- **Academic Demo Mode** — `/academic-demo` presentation flow and `/project` technical documentation for a viva.
- **Plans & teams** — Free / Starter / Pro / Agency with usage limits enforced on the server and in the database,
  usage meters and upgrade UI, team invitations and roles, in-app notifications, activity log, admin monitoring.
  Online payments are built (Stripe) but **not activated**.
- **Social sign-in** — Google and GitHub sign-in/sign-up via Supabase (enable the providers in Supabase).
- **Demo Project** — a separate, read-only workspace with sample data labelled **Demo Data** for presentations.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS) · Recharts ·
Cheerio · Zod · undici · Vitest + PGlite · Vercel

## Getting started

### Prerequisites

- Node.js 20.9+ (developed on Node 25)
- A free [Supabase](https://supabase.com) project

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Configure Supabase

1. Create a Supabase project (free tier is fine).
2. **Project Settings → API Keys**: copy the Project URL, the **publishable** key and the **secret** key into `.env.local`.
3. **Connect → Session pooler**: copy the URI into `DATABASE_URL` (replace `[YOUR-PASSWORD]` with your database password).
4. **Authentication → URL Configuration**: Site URL `http://localhost:3000`, redirect URL `http://localhost:3000/auth/callback`.

### 3. Create the database

```bash
npm run db:migrate
```

Optionally verify row-level security on the live database (runs in a rolled-back transaction):

```bash
npm run db:verify
```

### 4. Run

```bash
npm run dev
```

Open http://localhost:3000, register, and follow onboarding. Choose **Open Demo Project** to explore with sample data.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | publishable (or legacy anon) key |
| `NEXT_PUBLIC_SITE_URL` | yes | `http://localhost:3000` locally |
| `SUPABASE_SECRET_KEY` | yes for audits | server-only; crawler results, audit log, admin |
| `DATABASE_URL` | for scripts | Session pooler URI for migrations and live checks |
| `TOKEN_ENCRYPTION_KEY` | for Google | 32 random bytes, base64 (encrypts OAuth tokens) |
| `CRON_SECRET` | for background jobs | protects `/api/cron/crawl` and `/api/cron/ranks` |
| `PAGESPEED_API_KEY` | optional | Core Web Vitals in audits |
| `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | optional | live keyword data and rank tracking |
| `BACKLINK_PROVIDER` | optional | `dataforseo` enables the Backlinks module (needs the DataForSEO Backlinks subscription) |
| `BILLING_PROVIDER`, `BILLING_LIVE_APPROVED`, `STRIPE_*` | optional | payments stay off unless all are set and approved — see PRODUCTION-READINESS.md |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | optional | AI suggestions in the Content Optimizer (default model `claude-opus-5-5`) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional | Search Console + GA4 OAuth (redirect URI `<site>/api/integrations/google/callback`) |

Server-only values must never be prefixed with `NEXT_PUBLIC_`. `.env.local` is git-ignored.

### Make yourself a platform admin (optional)

```sql
insert into public.platform_admins (user_id, role) values ('<your auth user id>', 'superadmin');
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | development server |
| `npm run build` / `npm start` | production build / server |
| `npm run lint` | ESLint |
| `npm run typecheck` | route type generation + `tsc --noEmit` |
| `npm test` | all unit + database tests (Vitest, PGlite) |
| `npm run test:db` | migrations + RLS tests on embedded Postgres |
| `npm run check` | lint + typecheck + tests + build |
| `npm run test:e2e` | Playwright E2E + responsive checks (Microsoft Edge) against `npm run start`; needs `.env.local` with the service key |
| `npm run db:migrate` | apply pending migrations to `DATABASE_URL` (`-- --status` to list) |
| `npm run db:verify` | live RLS / tenant-isolation checks (rolled back) |
| `npm run db:types` | regenerate `src/lib/supabase/database.types.ts` from migrations |
| `npm run audit:live-check -- <url> <pages>` | real audit end-to-end with a temporary org, then cleanup |
| `npm run google:live-check` | Google OAuth/sync pipeline on the live DB with simulated Google APIs, then cleanup |
| `npm run reports:live-check` | all six report types from the Demo Project and a real audit, checked against SQL sums, then cleanup |
| `npm run phase6:live-check` | competitors, backlinks (test-double provider) and tasks on the live DB, then cleanup |
| `npm run content:live-check` | Page Explorer + Content Optimizer pipeline on the live DB against a real site, then cleanup |
| `npm run keywords:live-check` | keyword + rank pipeline on the live DB with a labelled fake provider, then cleanup |

Only run `audit:live-check` against sites you own or that allow crawling.

## Project structure

```
src/
  app/                    routes: marketing, auth, onboarding, app (org & site modules), admin, api
  components/             ui (design system), app shell, charts, audit, keywords, forms
  lib/
    auth/                 data access layer (getUser, requireOrg, requireWebsite), safe redirects
    actions/              server actions (validated with Zod, authorized)
    crawler/              crawl engine, parser, robots.txt, sitemaps, URL rules, stores, safe fetcher
    audit/                analyzer (33 rules), audit service, access control, PageSpeed
    seo/                  rule catalog + weighted scoring engine
    competitors/          comparison logic, snapshots, ranked-keyword overlap
    backlinks/            backlink sync service
    tasks/                task validation and helpers
    billing/              plans, entitlements, usage, billing providers (manual, Stripe)
    team/                 invitations
    reports/              report periods, snapshot builder, exporters
    content/              Content Optimizer analyzer, term sources, page recommendations
    ai/                   optional AI suggestion providers (Claude adapter)
    providers/            KeywordProvider / RankProvider, DataForSEO adapter, demo provider, registry
    keywords/             keyword service, CSV import/export, utilities
    security/             SSRF protection, safe fetch, AES-GCM token encryption
    supabase/             browser / server / admin clients + generated DB types
supabase/migrations/      SQL schema, RLS policies, grants, triggers, RPCs
tests/unit/               scoring, crawler, parser, analyzer, providers, CSV, security
tests/db/                 migrations, RLS, tenant isolation, triggers (PGlite)
scripts/                  migrate, live verification, type generation
docs/                     architecture, database, scoring, integrations, security, roadmap, demo guide, progress
```

## Testing

```bash
npm run check
```

347 automated tests (plus 15 Playwright E2E tests) cover the scoring engine, crawler (including SSRF protection against a real local server),
HTML parser, robots/sitemap parsing, content analyzer, AI prompt/output handling, analyzer rules, provider adapters, CSV handling, validation, encryption, and
database security (RLS, column privileges, triggers, tenant isolation). Live-database scripts verify the same
guarantees against Supabase.

## Deployment (Vercel)

1. Import the repository in Vercel and add the environment variables above (server-only ones unprefixed).
2. Set `NEXT_PUBLIC_SITE_URL` to the production URL and add `<url>/auth/callback` to Supabase redirect URLs.
3. Schedule `GET /api/cron/crawl` (every minute on Pro), `GET /api/cron/ranks` and `GET /api/cron/google-sync` (daily) with header
   `Authorization: Bearer $CRON_SECRET`. On Vercel Hobby, crons run at most daily; audits still progress while
   the audit page is open.

## Security highlights

- Row-level security on every table; users only see their own organizations' data (tested for every tenant table).
- Column-level grants: clients cannot write provider metrics, rankings, crawl results or audit scores.
- SSRF-hardened crawler: HTTP/HTTPS only, private/loopback/metadata addresses blocked at every DNS lookup and redirect.
- Secrets only in server environment variables; OAuth tokens encrypted with AES-256-GCM.
- Rate limits and plan quotas on expensive operations; cron endpoints protected by a shared secret.

See [docs/SECURITY.md](docs/SECURITY.md).

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — system design, routes, background jobs, provider abstraction
- [Database](docs/DATABASE.md) — schema, relationships, RLS and grants
- [SEO scoring](docs/SEO-SCORING.md) — formula, weights, every rule and threshold
- [Integrations](docs/INTEGRATIONS.md) — DataForSEO, PageSpeed, Google OAuth design, Demo Mode, CSV
- [Security](docs/SECURITY.md)
- [Production readiness](docs/PRODUCTION-READINESS.md) — Ready / Partially ready / Blocked / Requires paid API / Requires credentials / Future
- [Project documentation](docs/PROJECT-DOCUMENTATION.md) — frontend, backend, database, APIs, security, crawler, auth, charts, CRUD
- [Roadmap](docs/ROADMAP.md) · [Progress log](docs/PROGRESS.md) · [Academic demo guide](docs/ACADEMIC-DEMO.md)
