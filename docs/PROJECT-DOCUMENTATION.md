# Rankora — Project Documentation

A viva-oriented summary of how Rankora is built. The same content is shown in the app at **`/project`**.
Deeper detail: [ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [SECURITY](SECURITY.md) ·
[SEO-SCORING](SEO-SCORING.md) · [INTEGRATIONS](INTEGRATIONS.md) · [ACADEMIC-DEMO](ACADEMIC-DEMO.md).

## Architecture at a glance

```
Browser ──HTML / form posts──▶ Next.js 16 server (Vercel)
                               ├─ src/proxy.ts           session refresh, redirect signed-out users
                               ├─ pages (Server Components) + Server Actions   validate (Zod) → authorize (DAL) → service
                               ├─ Route Handlers (src/app/api)                 exports, job ticks, cron, OAuth
                               └─ services (src/lib/*)                         crawler, audit, sync, content, reports
                                      │                         │
                                      ▼                         ▼
                         Supabase (Postgres + RLS, Auth)   External APIs: Google GSC / GA4 / PageSpeed,
                                                           DataForSEO, Anthropic Claude (optional), crawled sites
```

## Frontend

* **Next.js 16 App Router, React 19, TypeScript (strict), Tailwind CSS 4.**
* Pages are **Server Components**: they query data on the server and send HTML, so secrets and SQL never reach the browser.
* **Client Components** only for interaction: forms with pending states (`useActionState`, `useFormStatus`), Recharts
  charts, the live audit/sync runners, the sidebar.
* **Design system** in `src/components/ui/` (Button, Card, Badge, Field, StatCard, ScoreRing, EmptyState): consistent,
  accessible (labels, focus rings, `aria-*`), responsive, with print styles for reports.
* **Honest states**: empty, loading, error, *Provider Not Connected*, and the purple **Demo Data** badge.

## Backend

* **Server Actions** (`src/lib/actions/*`) handle mutations. Each one validates input with Zod, checks the role with
  `requireWebsite(org, site, minRole)`, rate-limits expensive work, then calls a service.
* **Services** (`src/lib/{crawler,audit,keywords,google,content,competitors,backlinks,reports}`) hold the business
  logic. They are plain TypeScript, so live-check scripts and tests can run them too.
* **Background work** (crawls, Google syncs, rank checks) runs as resumable, time-boxed *ticks* with database claims.
  It is driven by the open page or by cron endpoints protected with `CRON_SECRET`.
* **Pure logic** (scoring, HTML parsing, content analysis, comparisons, report composition) is separated from I/O and
  unit-tested with fixtures.

## Database

* **Supabase PostgreSQL**: 43 tables, 13 ordered migrations (`supabase/migrations/`), 69 RLS policies, SQL functions
  and triggers. Types are generated into `src/lib/supabase/database.types.ts`.
* **Multi-tenancy**: `organization_id` on every tenant row. Composite foreign keys `(website_id, organization_id)` make it
  impossible to attach data to another tenant's website.
* **Main relationships**:
  * `organizations` 1─n `websites` 1─n `crawl_jobs` 1─n `crawl_pages` 1─n `crawl_links`
  * `crawl_jobs` 1─1 `seo_audits` 1─n `seo_checks`
  * `websites` 1─n `seo_issues` 1─n `seo_tasks`
  * `websites` 1─n `keywords` 1─n `keyword_rankings`
  * `websites` 1─n `search_console_*` / `analytics_*` (daily rows with a `source` column)
  * `websites` 1─n `competitors`, `backlinks`, `content_analyses`, `reports`
* **SQL functions** (`page_explorer`, `gsc_breakdown`, `ga_breakdown`, `rank_distribution`, `task_stats`,
  `backlink_referring_domains`) aggregate in the database and are `SECURITY INVOKER`, so RLS still applies.
* **Triggers** enforce rules the UI must not be trusted with:
  * the last owner cannot leave;
  * an assignee must be an organization member;
  * at most one open task per issue;
  * a report's Demo Data flag comes from its website.

## APIs

* **Own endpoints** (`src/app/api`): crawl job status/tick, integration sync, rank check, keyword and research CSV
  exports, report export (`?format=json|csv|pdf`), Google OAuth start/callback, and cron for crawl, ranks and
  google-sync.
* Every endpoint first loads the resource **as the signed-in user** (RLS): another tenant's id returns 404. Only then
  does it use the service role to write.
* **External APIs**: Google Search Console API, GA4 Data and Admin APIs, PageSpeed Insights, DataForSEO (keyword ideas,
  metrics, SERP, ranked keywords, backlinks), Anthropic Claude (optional AI suggestions).
* **Provider interfaces** (`KeywordProvider`, `RankProvider`, `DomainKeywordProvider`, `BacklinkProvider`, `AiProvider`)
  let a vendor be swapped without touching the UI. A missing provider is shown as *Provider Not Connected*.

## Security

* **Authorization in three layers**:
  1. proxy (signed-out users are redirected);
  2. data access layer (organization membership and minimum role on every page and action);
  3. Postgres RLS on every table, tested in `tests/db/`.
* **Column-level grants**: clients cannot write provider metrics, rankings, crawl results, scores, OAuth tokens,
  `completed_at` or the demo flag.
* **SSRF protection** for all user-supplied URLs: http/https only, no credentials, private/loopback/link-local/metadata
  ranges blocked at every DNS lookup (also at connect time) and every redirect; timeouts and size caps.
* **OAuth**: PKCE S256, hashed single-use state bound to user and website, read-only scopes, tokens encrypted with
  AES-256-GCM, revocation on disconnect.
* **Other controls**:
  * secrets only in server environment variables;
  * rate limits and monthly quotas on expensive operations;
  * CSV formula-injection protection;
  * security headers;
  * audit log of sensitive changes.

## SEO crawler

1. **Discovery**: start URL, robots.txt (RFC 9309 matching, crawl-delay) and XML sitemaps.
2. **Crawling**: same-site links only, within page, depth, size and time limits. Redirects are followed manually
   (max 5, each hop re-validated). The `RankoraBot` user agent is used, and robots.txt is respected.
3. **Parsing** with Cheerio: title, meta description, headings, canonical, robots, links, images and alt text,
   structured data, Open Graph and Twitter cards, word count, content hash.
4. **Link check, PageSpeed (optional), analysis**: 33 rules produce checks and issues. The score is the weighted share
   of passed rules ([SEO-SCORING.md](SEO-SCORING.md)).
5. The **frontier lives in the database** (`crawl_pages.fetch_state`), so a crawl survives restarts and runs in short
   ticks on serverless hosting.

## Authentication

* **Supabase Auth**: email + password (minimum 10 characters, letter + number), Google and GitHub sign-in, password
  reset by PKCE recovery link, and account settings.
* **Sessions**: HTTP-only cookies via `@supabase/ssr`, refreshed in `src/proxy.ts`. Identity comes from `getClaims()`,
  which verifies the JWT signature.
* **Roles** per organization: owner, admin, member and viewer. They are checked on the server and again by RLS.
* **Safe redirects**: post-login redirects accept relative paths only, which prevents open redirects.

## Data visualization

* Recharts trend charts for clicks/impressions and sessions/users.
* Ranking distribution bars and keyword position history (reversed axis).
* Score ring and category bars for the SEO health score; task progress bar on the dashboard.
* Deltas are coloured by whether "up" is good. Days without data are not drawn as zeros. Every chart names its source,
  and demo data carries the Demo Data badge.

## CRUD

| Entity | Create | Read | Update | Delete |
|---|---|---|---|---|
| Organization | onboarding | switcher, settings | rename | — (planned) |
| Website | add website form | list, dashboard | settings, crawl settings | owner/admin |
| Keyword / group | add, CSV import, from research | list, detail, export | target URL, tracking, notes | bulk delete |
| Competitor | add domain | list, comparison tabs | name, notes | remove |
| SEO task | manual, from issue(s) | board, detail | every field, status on board | delete |
| Issue | (created by audit) | audit, issue detail | ignore / reopen | — |
| Content analysis, report | analyze / create | history, report view, export | — (snapshots are frozen) | delete |

Server-only data (crawl results, metrics, rankings, snapshots, backlinks) is created by services. Members can read it,
but clients can never write it.

## Testing

* **Unit tests**: scoring, URL safety, crawler parts, HTML parser, analyzer rules, providers, CSV, content analysis,
  AI prompt and output handling, competitor comparisons, report composition and exports.
* **Database tests**: PGlite loads the real migrations and tests RLS, grants, triggers, functions and tenant isolation.
* **Live checks** run against the real Supabase project and a real website, then clean up:
  `db:verify`, `audit:live-check`, `keywords:live-check`, `google:live-check`, `content:live-check`,
  `phase6:live-check`, `reports:live-check`.
