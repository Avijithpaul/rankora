# Rankora — Architecture

## 1. Overview

```
Browser ──► Next.js 16 (App Router, Vercel)
              │  proxy.ts            session refresh + optimistic route guard
              │  Server Components   read data as the user (RLS enforced)
              │  Server Actions      validated mutations (zod) as the user
              │  Route Handlers      OAuth callbacks, cron/worker endpoints, exports
              │
              ├─► Supabase Auth      email/password, JWT in cookies (verified with getClaims)
              ├─► Supabase Postgres  multi-tenant schema, RLS, RPCs, queue tables
              └─► External providers (server-side only)
                    Google Search Console · GA4 · PageSpeed Insights
                    Keyword / SERP / Backlink provider (DataForSEO adapter, pluggable)
                    Target websites (crawler, SSRF-guarded)
```

### Tenancy model

`auth.users → organization_members (role) → organizations → websites → all SEO data`

* Every tenant table carries `organization_id`; RLS checks membership with one indexed lookup
  (`private.is_org_member` / `private.has_org_role`).
* Child tables reference websites with a **composite FK** `(website_id, organization_id)`, so a row
  can never claim a different organization than its website. This is a second line of defence behind RLS.
* Roles: `owner > admin > member > viewer`. Viewers are read-only; admins manage members and delete
  websites; only owners can grant ownership; the last owner cannot be removed (DB triggers).

### Three Supabase clients

| Client | File | Acts as | Use |
|---|---|---|---|
| Browser | `src/lib/supabase/client.ts` | user | client components (rare) |
| Server | `src/lib/supabase/server.ts` | user (cookies) | pages, actions — **RLS applies** |
| Admin | `src/lib/supabase/admin.ts` | service role | crawler writes, token storage, audit log, admin aggregates — only **after** an explicit authorization check |

### Data Access Layer

`src/lib/auth/dal.ts` is the single entry point for "who is the user, what can they access":
`getUser()`, `requireUser()`, `requireOrg(slug, minRole)`, `requireWebsite(slug, siteId, minRole)`.
Every page and server action calls it; RLS is the final enforcement.

### Rendering model

`cacheComponents` is **disabled**. Nearly all app routes are per-user and read the session, so the
classic dynamic model is simpler and avoids session-specific prerendered shells. Marketing pages are static.

## 2. Route structure

```
Public (static)    /, /features, /seo-audit, /keyword-research, /analytics,
                   /rank-tracking, /pricing, /about, /contact
Auth               /login, /register, /auth/callback (PKCE code exchange)
Onboarding         /onboarding → /onboarding/website → /onboarding/next-steps
App (org scope)    /app → /app/[org] → /app/[org]/websites(/new)
                   /app/[org]/settings, /app/[org]/billing
App (site scope)   /app/[org]/sites/[site]/
                     dashboard · analytics · search-performance · keyword-research
                     keywords · rank-tracker · competitors · backlinks · audit
                     technical · pages (Page Explorer) · content(/[analysisId]) · competitors(/[id])
                     backlinks · tasks(/[taskId]) · reports
                     integrations · settings
Admin              /admin (platform_admins only; 404 otherwise)
Planned handlers   /api/cron/crawl, /api/integrations/google/{start,callback},
                   /api/sites/[id]/keywords/export, /api/reports/[id]/pdf
```

Unbuilt site modules are served by one catch-all `sites/[site]/[module]` page that renders an
explicit **"Planned · Phase N"** state (driven by `src/lib/navigation.ts`). Built modules get their
own static folder, which takes precedence over the catch-all.

## 3. Background jobs (crawls, syncs, rank checks)

Vercel functions are short-lived, so long work is modelled as **resumable jobs in Postgres** (implemented in Phase 2):

```
startAuditAction (server action)          role ≥ member, not demo, rate limit 10/h, plan page cap
  └─ crawl_jobs row (queued, settings snapshot)      one active job per website (partial unique index)

POST /api/crawl-jobs/[id]/tick  ← audit page polls while open      ┐ authorizeJob(): job read AS THE USER (RLS)
GET  /api/cron/crawl            ← scheduler, Bearer CRON_SECRET     ┘ then service role
  └─ processJob(): claim lock (locked_at < now-90s), run one ~20 s tick, release
       discovery  → robots.txt, sitemaps (+index), HTTP→HTTPS check, seed frontier
       crawling   → crawl_pages rows with fetch_state='pending' ARE the frontier
                    same-site only, depth/page caps, robots, excludes, 3 attempts, SSRF-safe fetch
       link_check → HEAD/GET external targets (optional, max 100)
       pagespeed  → PageSpeed Insights (if PAGESPEED_API_KEY)
       analyzing  → analyzeSite() → computeScore() → seo_audits, seo_checks, seo_issues lifecycle
```

Code: `src/lib/crawler/*` (engine, parser, robots, sitemap, URL rules, stores), `src/lib/audit/*`
(analyzer, service, access control, PageSpeed). The engine depends only on a `CrawlStore` and a
`Fetcher` interface, so it is tested end-to-end in memory against a simulated website.

Issues are upserted by fingerprint (rule id) so detected and fixed dates persist across audits.
On Vercel Hobby, cron jobs run at most daily, so the open audit page drives progress; on Pro, schedule
`/api/cron/crawl` every minute.

The same queue pattern serves GSC/GA4 daily syncs and rank checks. The worker can move off Vercel
(for example, a container running the same TypeScript module) without schema changes.

## 4. Provider abstraction

```ts
interface KeywordDataProvider {
  id: string; // 'dataforseo'
  relatedKeywords(q): Promise<KeywordIdea[]>;
  searchVolume(keywords, market): Promise<KeywordMetrics[]>;
}
interface SerpProvider     { rankFor(keyword, market, device, domain): Promise<RankResult> }
interface BacklinkProvider { backlinks(domain, opts): Promise<BacklinkPage> }
```

A registry returns the configured provider or `null`. With `null` the UI shows a "connect a provider"
state and never substitutes generated values. Every stored metric records its `source`,
`metrics_source` or `provider`.

## 5. Code layout

```
src/
  app/                    routes (see above)
  components/ui/          design system primitives (Button, Card, Badge, Field, StatCard, ScoreRing, states)
  components/app/         application shell (sidebar, user menu)
  components/charts/      Recharts wrappers
  components/forms/       shared forms
  lib/auth/               DAL, safe redirects
  lib/actions/            server actions (validated, authorized)
  lib/security/           url-safety (SSRF), safe-fetch, crypto (AES-GCM)
  lib/seo/                rule catalog + scoring engine (pure, unit tested)
  lib/competitors/        competitor comparison (pure), snapshot/overlap services, data loaders
  lib/backlinks/          backlink sync service (provider → backlinks table)
  lib/tasks/              task validation, labels, stats helpers
  lib/content/            Content Optimizer: document model, 21-check analyzer, term sources, page recommendations
  lib/ai/                 optional AI suggestion providers (interface, prompts, Claude adapter, registry)
  lib/supabase/           clients + generated DB types
  lib/validation/         zod schemas
supabase/migrations/      SQL schema, RLS, grants, RPCs
tests/unit/               pure logic tests
tests/db/                 migrations + RLS tests on embedded Postgres (PGlite)
scripts/gen-db-types.mts  DB types generated from the migrations
```

## 6. Design system

Semantic tokens live in `src/app/globals.css`: `canvas`, `surface`, `line`, `ink`, `muted`, `brand`,
the severity colours `critical`, `warning`, `opportunity` and `success`, and `demo`. Components use only
these tokens. The layout pairs a dark navy sidebar with a light content area, the Geist typeface and
tabular numerals for metrics. Every data view has explicit **empty**, **loading** (`loading.tsx` skeletons)
and **error** (`error.tsx`) states.
