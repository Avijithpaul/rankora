# Rankora — Progress Log

## Phase 6 — Competitors, Backlinks & SEO Workflow (2026-10-28)

### Completed

* **Competitor management**: up to 10 competitor domains per website (URL or bare host accepted, normalised; own
  domain, IPs and single-label hosts refused); name/notes editable, domain immutable; removal deletes all stored
  comparison data (cascade).
* **Comparison UI** (`/competitors/[id]`, four tabs), each showing only data that was actually observed:
  * **Rankings**: the daily rank check now also reads every competitor's position from the *same* SERP response,
    with no extra provider call (`competitor_rankings`). Positions are compared only when both come from the same
    check date. Summary shows you ahead, they ahead, only you/only them and visibility share.
  * **Keyword overlap & gaps**: provider "ranked keywords" snapshots for your domain and the competitor's
    (DataForSEO Labs `ranked_keywords`, up to 1,000 each, cached 7 days, counted as keyword lookups). Shows shared
    keywords, gaps (they rank, you don't), shared keywords where they are ahead, and own-only keywords.
  * **SEO audit comparison**: both homepages fetched now by RankoraBot (robots.txt respected), plus robots.txt and
    sitemap. The same 15 checks are applied to both sides, shown next to your full audit score. It is labelled as a
    single-page snapshot, not a competitor crawl.
  * **Content/page comparison**: your page against their page for a keyword with the Content Optimizer's 21
    checks, with comparison history. Each URL must be on its own domain.
* **Backlink provider abstraction**: `BacklinkProvider` (summary, live and lost links) with a DataForSEO Backlinks
  adapter. It is enabled only with `BACKLINK_PROVIDER=dataforseo` (separate subscription); otherwise the page shows
  "Provider Not Connected". The Backlinks module has tabs for backlinks, referring domains, anchor text, new links
  and lost links. Sync history and a monthly sync quota are kept. Each sync replaces the stored set, so links the
  provider no longer returns are removed rather than shown as current. New/lost flags come from the provider and are
  never inferred.
* **SEO Task Management** (`/tasks`): four-column board (To Do, In Progress, Completed, Ignored) with quick status
  changes; filters by assignee and priority; stat cards (to do, in progress, completed with completion rate,
  overdue, due in 7 days).
  * Task detail/edit page with all fields: title, website, page, priority, status, assignee, due date, source issue
    and notes.
  * Create tasks from issues: "Create task" on an issue, or "Create N tasks from open issues" on Site Audit. Title,
    priority (from severity), page (single affected page) and notes (recommendation) come from the stored issue.
  * At most one open task per issue (database index). Tasks show "Issue fixed" when a later audit resolves the issue.
* **Dashboard**: "SEO task progress" card with completion bar, counts, overdue and the next open tasks.

### Files changed

New: `src/lib/competitors/{compare,service,data}.ts`, `src/lib/backlinks/service.ts`, `src/lib/tasks/utils.ts`,
`src/lib/org/members.ts`, `src/lib/actions/{competitors,tasks}.ts`, `src/components/tasks/{task-form,task-progress}.tsx`,
pages `competitors/page.tsx`, `competitors/[competitorId]/page.tsx`, `backlinks/page.tsx`, `tasks/page.tsx`,
`tasks/[taskId]/page.tsx`, migration `…0011_competitors_backlinks_tasks.sql`, `scripts/live-phase6-check.mts`,
tests `tests/unit/competitors.test.ts`, `tests/db/phase6.test.ts`.
Changed: `src/lib/providers/{types,dataforseo,registry}.ts` (competitor SERP positions, ranked keywords, backlinks),
`src/lib/keywords/service.ts` (rank batch stores competitor positions), audit page and issue page (task creation),
dashboard, navigation (Competitors, Backlinks and SEO Tasks live; Reports moved to Phase 7), `src/lib/env.ts`,
`.env.example`, `scripts/verify-live-db.mts` (41 tables), docs.

### Database changes

`…0011`: `competitor_rankings`, `domain_keyword_snapshots`, `competitor_snapshots`, `backlink_syncs` (RLS
member-read, server-write only; snapshots member-deletable); `backlinks.is_new/is_lost/link_type`;
`backlink_referring_domains()`, `backlink_anchors()`, `task_stats()` (security invoker); unique open task per issue;
trigger that a task's issue belongs to the same website; column grants: competitors (name, notes) and seo_tasks
(title, notes, priority, status, assignee, due date, page) — clients cannot change `completed_at`, `created_by`,
`website_id` or a competitor's domain. Applied live; `db:verify` passes.

### Tests performed

* `npm run check`: lint, typecheck, **309 tests in 24 files** (+21), production build — all pass.
* Unit: domain normalisation, competitor positions from one SERP (paid results ignored, subdomains matched),
  ranked-keyword / backlink / summary parsers against the documented DataForSEO response fields, backlink provider
  stays disconnected unless enabled, ranking summary (only same-SERP observations), overlap/gaps/behind, homepage
  snapshot checks with unknowns kept unknown, task validation (dates, URL scheme, uuid), severity → priority,
  overdue, completion rate.
* DB (PGlite): server-only writes for competitor data and backlinks, immutable competitor domain, viewer cannot add,
  cascade on delete, referring-domain/anchor aggregation and RLS, one open task per issue, issue must belong to the
  website, completed_at protected, assignee must be a member, viewer read-only, task_stats.
* Live (`npm run phase6:live-check`, temporary org cleaned up):
  * Real homepage comparison of books.toscrape.com vs quotes.toscrape.com. Findings confirmed with curl: both
    robots.txt return 404, quotes has no viewport and a 16-character title.
  * Real page comparison (73.9 vs 48.8); off-site and metadata URLs refused.
  * Overlap without a provider returns not_connected and stores nothing.
  * Competitor position stored from the same SERP via a labelled test-double SERP through the real parser.
  * Backlink sync with a test-double provider: 3 rows, aggregation as the user, stale rows removed on the next sync,
    client insert denied.
  * Tasks: duplicate open task and outside assignee rejected, task_stats overdue, completed_at set by the database,
    stranger sees nothing.
* Browser: signed-out access to the new routes redirects to sign-in, no server errors.

### Known limitations

* No real DataForSEO calls were made (no credentials). Parsers follow the documented response fields and are
  fixture-tested, but the adapters have not run against the live API.
* Competitor rankings exist only for your tracked keywords, from the date the competitor was added (no backfill).
* Overlap and gaps cover at most 1,000 keywords per domain (best positions first) and depend on the provider's index.
* The SEO audit comparison is a homepage snapshot; competitors are not fully crawled.
* Backlinks store at most 1,000 live and 200 lost links per sync; totals come from the provider summary.
* The signed-in UI of the new pages has not been viewed in a browser (requires the owner's account).
* The Demo Project has no competitor, backlink or task data (read-only, honest empty states).

### Next tasks

* Phase 7: Reports (overview, audit, traffic, rankings, printable/PDF), team invitations, notifications, billing.
* Optional: email/notification when a task is assigned; auto-suggest completing tasks whose issue is fixed.

## Phase 5 — Page SEO & Content Optimization (2026-10-27)

### Completed

* **Page Explorer** (`/sites/[site]/pages`): every URL of the latest audit joined, in one SQL function
  (`page_explorer()`), with Search Console clicks/impressions/position for the chosen range, GA4 page views
  (matched by path), open audit issues and mapped keywords. Sort by clicks, impressions, views, position, issues,
  inlinks or word count; filter by URL, status and indexability; source badges, or "not connected" links.
* **Page details**: new Search performance and Traffic cards (28 days vs previous 28), Target keywords (target URL
  or current ranking URL), rule-based **Recommendations** that combine crawl facts with search and traffic data
  (low CTR on page one, striking distance, noindex with demand, no impressions, no keyword mapped, thin content
  with traffic, orphan/deep page, metadata, open issues). Each states the numbers behind it. "Optimize content"
  opens the Content Optimizer pre-filled.
* **Content Optimizer** (`/sites/[site]/content`): target keyword plus a URL on the website (fetched through the
  SSRF-safe fetcher) or a pasted draft (Markdown, HTML or plain text, with optional title/meta). 21 deterministic
  checks in 8 categories: metadata, headings, keyword placement, structure, length, links, semantic coverage,
  readability. Weighted 0–100 score, every check shows what was measured, the threshold and the fix, prioritised
  recommendations, heading outline, most-used terms.
* **Semantic coverage architecture**: related terms come only from real sources, each labelled — the user's own
  terms, Search Console queries sharing a keyword word (by impressions) and saved keywords. No terms gives an
  informational check, not an invented list.
* **Internal-link opportunities**: rule-based, from crawled indexable pages that share keyword words and are not
  linked yet.
* **Optional AI suggestions** (`src/lib/ai/`): `AiProvider` interface, Claude adapter (`claude-opus-5-5`, structured
  JSON output validated with zod), registry returning null without `ANTHROPIC_API_KEY` ("AI provider not
  connected"). Six tasks: SEO titles, meta descriptions, content outline, FAQs, content improvements, internal-link
  suggestions. Page text is fenced as untrusted data; the system prompt forbids invented facts and ranking
  promises. Output is sanitised: lengths/counts capped, and internal-link targets must come from the crawled
  candidate list. Every stored result carries `label: "AI suggestion"`, provider, model and time, and is shown
  with an "AI suggestion" badge. **Nothing is ever published or written to the user's website.**
* **History**: every analysis is stored in `content_analyses` (results, score, scoring version, word count,
  AI suggestions). It is listed per website, readable by members and deletable by member+.

### Files changed

New: `src/lib/content/{document,analyze,sources,service,page-recommendations}.ts`, `src/lib/ai/{types,prompts,anthropic,registry}.ts`,
`src/lib/actions/content.ts`, `src/components/content/{analyze-form,submit-button}.tsx`, pages `content/page.tsx`,
`content/[analysisId]/page.tsx`, migration `…0010_content_optimizer.sql`, `scripts/live-content-check.mts`,
tests `tests/unit/content.test.ts`, `tests/unit/ai-content.test.ts`, `tests/db/content.test.ts`.
Changed: `pages/page.tsx` (Page Explorer), `pages/[pageId]/page.tsx`, `src/lib/env.ts` (`aiConfig`), `src/lib/navigation.ts`
(Content Optimizer live; SEO Tasks moved to Phase 6), `.env.example`, `package.json` (`@anthropic-ai/sdk`, `content:live-check`), docs.

### Database changes

`…0010`: `content_analyses.scoring_version / word_count / ai_generated_at`, check that URL analyses have a source
URL, index `(website_id, created_at desc)`; `url_path()`; `page_explorer()` (security invoker, authenticated only,
wildcards in the search escaped). Applied to the live project; `db:verify` passes.

### Tests performed

* `npm run check`: lint, typecheck, **288 tests in 22 files** (+42), production build — all pass.
* Unit: tokenizer/plural folding/phrase matching, Markdown and HTML draft parsing, main-content selection,
  readability (Flesch only for English), term coverage and sources, link opportunities, every check category,
  keyword stuffing, determinism, prompt fencing, output sanitising (invented internal URLs dropped), Claude adapter
  with a mocked transport (request shape, refusal, auth error), page recommendations.
* DB (PGlite): `page_explorer` joins (date range, GA4 non-landing by path, issues, keywords), filters, sorting,
  paging, wildcard escaping, RLS isolation, anonymous denied; `content_analyses` server-write-only, member
  read/delete, cross-tenant delete has no effect, URL constraint.
* Live (`npm run content:live-check`, books.toscrape.com, temporary org cleaned up): 10-page audit → URL analysis
  (score 84.9, 315 words, 21 checks, related terms with sources, 9 link opportunities) → draft analysis → off-site
  URL and `127.0.0.1` rejected → AI path: no provider gives `not_connected`, a labelled test double is stored as
  "AI suggestion", another website's analysis is not found → `page_explorer` as the signed-in user returns 10 rows
  with the keyword mapping, a stranger gets 0.
* Bugs found and fixed while testing: (1) on listing pages each product card is an `<article>`, so the first card
  was taken as the main content (11 words); a single `<article>` is now used only when it is the only one.
  (2) Text from adjacent blocks was concatenated ("PostBody"); block ends are now padded. (3) A refusal with
  empty text made the SDK's `parse()` throw; the adapter now checks `stop_reason` and validates JSON itself.
* Browser: signed-out access to the new routes redirects to sign-in with no server errors.

### Known limitations

* Not verified with a real AI call: no `ANTHROPIC_API_KEY` is configured. The adapter is covered by mocked-transport
  tests and the storage path by the live check.
* The signed-in UI of the new pages has not been viewed in a browser (it requires the owner's account).
* Page metrics match URLs exactly: Search Console by the full normalized URL, GA4 by path without a query string.
  Variants (trailing slash, parameters) are not merged.
* Per-page *queries* are not available: the sync stores queries and pages separately (no query×page dimension).
* Readability uses the English Flesch formula and a syllable heuristic; other languages get sentence and paragraph
  statistics only.
* URL mode fetches only pages on the website's own domain and does not render JavaScript.
* The Demo Project is read-only, so new analyses cannot be run in it.
* The crawler's own text extraction (`parse-page.ts`) has the same glued-words issue as (2) above; it affects audit
  word counts and is flagged as a separate follow-up.

### Next tasks

* Phase 6: SEO Tasks (issue → task, board, assignees), Competitors, Backlinks (provider only), Reports.
* Optional: query×page Search Console sync for per-page queries; URL variant merging in the Page Explorer.

## Phase 4 — Google Search Console & GA4 (2026-10-27)

### Completed

* **Secure OAuth** (`src/lib/google/oauth.ts`, `/api/integrations/google/{start,callback}`): authorization code + PKCE S256,
  hashed single-use state bound to user/org/website with 10-minute expiry, read-only scopes, offline access,
  encrypted token storage, automatic refresh, revocation, per-organization connections per Google account.
* **Property selection**: live lists from the Search Console API and GA4 Admin API, suggested match for the
  website's domain, server-side re-validation of the chosen property.
* **Sync engine** (`src/lib/google/sync.ts`): 5 Search Console steps + 6 GA4 steps, 180-day initial import and
  5-day incremental sync, resumable time-boxed ticks with claims, idempotent re-sync, retry on 429/5xx/network,
  clear error states for expired tokens and lost permissions. API: `POST|GET /api/integrations/[id]/sync`,
  `GET /api/cron/google-sync`.
* **Integrations page**: status per service, connect / reconnect, property picker, sync progress, Sync now,
  Full re-sync, disconnect (optionally deleting imported data), connected Google accounts with Revoke (admins),
  status of PageSpeed and DataForSEO.
* **Search Performance**: Overview (clicks, impressions, CTR, average position with deltas, daily chart, top
  queries/pages), Queries, Pages, Countries, Devices — date presets, custom ranges, previous-period or
  year-over-year comparison, per-row deltas.
* **Analytics**: Overview (users, new users, sessions, views, engaged sessions, engagement rate, average engagement
  time, organic sessions), Traffic, Pages (top pages + landing pages), Acquisition (channels), Countries, Devices.
* **Honest states** everywhere: not configured, not connected, choose property, first import, error/reconnect,
  rate-limited, no data, Demo Data.
* **Row-cap fix (bug found this phase)**: the Supabase Data API returns at most 1,000 rows per request. Dashboard top
  queries/pages, Rank Tracker distribution/movement, Technical SEO stats, keyword CSV export and the saved-keywords
  group filter could silently under-count on large sites. Fixed with SQL aggregations (`gsc_breakdown`,
  `ga_breakdown`, `rank_distribution`), `keywords.previous_checked_on`, a paging helper and inner-join filters.
* Social sign-in (Google / GitHub) from the previous step is included in this phase's changes.

### Files changed

New: `src/lib/google/{errors,oauth,http,search-console,analytics,connections,sync,integration-access}.ts`,
`src/lib/analytics/{ranges,source}.ts`, `src/lib/actions/integrations.ts`, `src/lib/supabase/paginate.ts`,
`src/components/analytics/controls.tsx`, `src/components/integrations/sync-runner.tsx`,
pages `integrations`, `search-performance`, `analytics`, API routes `integrations/google/start|callback`,
`integrations/[id]/sync`, `cron/google-sync`, migrations `…0008_oauth_profiles.sql`, `…0009_google_integrations.sql`,
`scripts/live-google-check.mts`, tests `tests/unit/google.test.ts`, `tests/db/google.test.ts`.
Changed: dashboard, rank tracker, technical SEO, saved keywords, keyword export, navigation, `scripts/gen-db-types.mts`
(TABLE-returning functions), `src/lib/dashboard/metrics.ts`, docs.

### Database changes

`…0008`: profile name/avatar from social sign-in. `…0009`: `oauth_connections.provider_account_id/status` + unique
active connection per org/account; `integrations.sync_state/last_sync_started_at/sync_claimed_at`; date indexes on
synced tables; `gsc_breakdown()`, `ga_breakdown()`, `rank_distribution()` (security invoker, authenticated only);
`keywords.previous_checked_on` + updated position trigger. Both applied to the live project.

### Tests performed

| Check | Result |
|---|---|
| `npm test` | **246 passed**, 19 files (new: Google unit 18, Google DB 7, OAuth profile 4, social sign-in 4, movement 1) |
| OAuth boundaries | PKCE RFC 7636 vector, auth URL (read-only scopes, offline, S256), state checks (unknown/reused/expired/other user/provider), code exchange body, `invalid_grant` → reconnect, network errors retryable, API error mapping |
| API clients | Search Console paging (25k rows/page), site suggestion, GA4 report flattening, malformed property ids rejected before any call |
| DB | breakdown functions aggregate correctly and respect RLS (other tenants get 0 rows, anon denied), tokens/states unreadable, clients cannot write integrations or synced data, rank distribution, previous_checked_on |
| Live DB with simulated Google (`google:live-check`) | 16/16: refresh + encrypted storage, full GSC (5 steps) and GA4 (6 steps) sync, rows labelled gsc/ga4, SQL breakdowns, idempotent re-sync, revoked token → expired + reconnect flag, sync stops cleanly, disconnect revokes and wipes tokens |
| `db:verify`, `keywords:live-check` (live) | 15/15, 14/14 |
| API (running server) | start without session → 401; forged state → rejected (`unknown_state`); sync for unknown/other integration → 404; cron without secret → 401; pages signed out → login |
| `lint` / `typecheck` / `build` | clean / clean / success |

### Known limitations

* **Not yet run against real Google**: no `GOOGLE_CLIENT_ID/SECRET` configured, so the consent screen, real
  property lists and real API responses have not been exercised; Google was simulated in tests.
* Signed-in pages still not viewed in a browser by the owner.
* GA4 users over multi-day ranges are summed daily users (stated in the UI).
* Country rows use Google's codes/names as returned (GSC ISO alpha-3, GA4 country names).
* Background sync relies on a scheduler calling `/api/cron/google-sync` (daily on Vercel Hobby).

### Next tasks

1. Owner: create the Google OAuth client, enable the three APIs, add the redirect URI and env vars; connect a real property.
2. Phase 5 — Content Optimizer & SEO Tasks.

## Phase 3 — Keywords & Rank Tracking (2026-10-26)

### Completed

* **Provider abstraction** (`src/lib/providers/`): `KeywordProvider` + `RankProvider` interfaces, **DataForSEO**
  adapter (keyword ideas, metrics, Google/Bing organic SERP positions; pure request/response mapping), registry
  returning `null` when credentials are missing, demo provider restricted to Demo Project websites.
* **Keyword Research**: seed + country + language, related / long-tail / question tabs, sort by volume, difficulty,
  CPC, A–Z, clusters, intent (provider or clearly marked rule-based), recent searches, 7-day cache, monthly quota,
  rate limit, CSV export, save selected keywords (optionally tracked / into a group). Metrics are copied from the
  server-stored provider response.
* **Saved Keywords**: filters (search, group, tracked, intent), pagination, groups (create/delete, counts, filter),
  bulk actions (track/untrack, add/remove group, fetch metrics from provider, delete), manual add, CSV import with
  line-numbered errors, CSV export.
* **Keyword Detail**: current / previous / best position, last check, metrics with source, monthly volume trend,
  ranking history chart (inverted axis, gaps = not ranking), snapshot table with sources, target URL + notes,
  warning when Google ranks a different URL than the target.
* **Rank Tracker**: Tracked, Top 3 / 10 / 20 / 100, Improved, Dropped, New / Lost, 30-day stacked distribution chart,
  filters (group, device, position range, movement), table with movement badges, quick “start tracking”,
  “Check N keywords now” runner, CSV export.
* **Historical storage**: `keyword_rankings` (one snapshot per keyword per day) + trigger-maintained current/previous/best.
* **Provider Not Connected** card/badge everywhere live data would appear; Demo Data badges on demo results.
* **APIs**: `POST|GET /api/sites/[id]/rank-check`, `GET /api/cron/ranks`, `GET /api/sites/[id]/keywords/export`,
  `GET /api/keyword-research/[queryId]/export`.

### Files changed

New: `src/lib/providers/{types,dataforseo,locations,demo,registry}.ts`, `src/lib/keywords/{utils,csv,service,site-access}.ts`,
`src/lib/actions/keywords.ts`, `src/components/keywords/{provider-not-connected,badges,rank-check-runner}.tsx`,
`src/components/charts/rank-charts.tsx`, pages `keyword-research`, `keywords`, `keywords/[keywordId]`, `rank-tracker`,
API routes above, `supabase/migrations/20261026000007_keywords_tracking.sql`, `scripts/live-keywords-check.mts`,
`tests/unit/keywords.test.ts`, `tests/db/keywords.test.ts`.
Changed: `src/lib/navigation.ts`, `package.json`, generated DB types, docs.

### Database changes

Migration `20261026000007_keywords_tracking.sql` (applied live): `keywords.current_position/previous_position/
best_position/current_url/last_checked_on/rank_source/rank_check_claimed_at/search_volume_trend`; trigger
`keyword_rankings_refresh` → `refresh_keyword_position()`; backfill; column grants (no client writes of metrics or
positions); demo keywords read-only; research index.

### Tests performed

| Check | Result |
|---|---|
| `npm test` | **212 passed**, 15 files (new: keywords/providers/CSV 18, keywords DB 8) |
| DataForSEO adapter | location codes, envelope/task errors, null preservation, related/suggestions/overview parsing, SERP matching (subdomains yes, ads no, look-alike domains no), auth header + request body, 401 / network errors |
| CSV | quotes, escaped quotes, CRLF, BOM, `;`, header aliases, defaults, per-line validation, 500-row cap, metric columns ignored, formula-injection escaping |
| DB | position trigger (out-of-order inserts, null = not ranking, deletes), demo backfill, clients cannot write metrics/positions/rankings/research, demo keywords read-only, tenant isolation, cross-org group membership blocked |
| Live DB (`keywords:live-check`) | 14/14: not-connected path, research stored + cache hit + metering, metrics applied with source label, rank batch, no double charge, trigger, claims released, refusal without provider; temporary data deleted |
| `db:verify` (live) | 15/15 |
| API (running server) | rank-check / exports without session → 401, bad id → 404, cron without secret → 401, page → login redirect |
| `lint` / `typecheck` / `build` | clean / clean / success |

### Known limitations

* **No real provider credentials configured** — live search volumes and Google positions are not available until
  `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` are set; the real DataForSEO API has only been exercised through
  fixture-based tests, not a live call.
* Signed-in UI pages not yet viewed in a browser (owner account needed).
* Clustering is a simple shared-token heuristic; SERP-overlap clustering would need extra provider calls.
* Rank checks use DataForSEO live (synchronous) endpoints; very large keyword sets would be cheaper with the
  task-based (async) API.
* Keyword device/market cannot be edited after creation (delete and re-add instead).

### Next tasks

1. Owner: add DataForSEO credentials (or keep “Provider Not Connected” for the presentation and use the Demo Project).
2. Phase 4 — Google Search Console & GA4 OAuth integrations.

## Phase 2 — Real Site Audit Engine (2026-10-26)

### Completed

* **Crawler** (`src/lib/crawler/`): resumable, time-boxed engine with phases discovery → crawling →
  link_check → pagespeed → analyzing. robots.txt parser (RFC 9309: groups, longest match, Allow ties,
  `*`/`$`, Crawl-delay), XML sitemap + sitemap index parsing, HTTP→HTTPS check, same-site scope (± www),
  URL normalisation (fragments, default ports, tracking params), asset skipping, exclude globs, depth and
  page caps, redirect chains (targets queued as their own pages), retries (3 attempts on network errors,
  429 and 5xx), timeouts, optional external link checks. Every request goes through the SSRF-safe fetcher.
* **Parser** (`parse-page.ts`, Cheerio): title, meta description, H1/H2 and heading order, canonical
  (with `<base href>`), robots meta + X-Robots-Tag, indexability, lang, viewport, images/ALT/dimensions,
  internal/external/nofollow links, JSON-LD/microdata/RDFa types, Open Graph, Twitter, visible word count,
  content hash, meta refresh.
* **Analyzer** (`src/lib/audit/analyze.ts`): evaluates all 33 rules from real crawl data with documented
  populations and thresholds; rules that cannot be evaluated are "not applicable" (never guessed).
  Scored by the existing weighted engine.
* **Persistence & lifecycle**: crawl pages/links, job state, audits, checks, issues (open → fixed → reopened,
  ignored kept), affected pages, website latest score, usage records, audit log.
* **API**: `POST /api/crawl-jobs/[id]/tick`, `GET /api/crawl-jobs/[id]`, `GET /api/cron/crawl` (CRON_SECRET).
* **UI**: Site Audit dashboard (live progress, score ring, category scores, Critical/Warning/Opportunity/
  Passed/N-A filters, expandable checks with explanation + fix + sample URLs, audit history with score
  deltas, view older audits, Run/Re-run), issue detail (explanation, fix, timeline, affected pages,
  ignore/reopen), Pages (search, status/indexability filters, pagination, issue counts), page details
  (metadata checks, content, links in/out, redirect chain, open issues), Technical SEO (robots.txt,
  sitemaps, HTTPS, status codes, indexability reasons, response-time percentiles, Core Web Vitals).
* **PageSpeed Insights** client (field data preferred, lab fallback) — used when `PAGESPEED_API_KEY` is set.
* **Scripts**: `db:migrate`, `db:verify`, `audit:live-check`.

### Files changed

New: `src/lib/crawler/{url,robots,sitemap,parse-page,types,engine,memory-store,supabase-store,fetcher}.ts`,
`src/lib/audit/{analyze,mappers,service,access,job-access,pagespeed,labels}.ts`, `src/lib/actions/audit.ts`,
`src/app/api/crawl-jobs/[id]/route.ts`, `src/app/api/crawl-jobs/[id]/tick/route.ts`, `src/app/api/cron/crawl/route.ts`,
`src/app/app/[org]/sites/[site]/{audit,audit/issues/[issueId],pages,pages/[pageId],technical}/page.tsx`,
`src/components/audit/audit-runner.tsx`, `supabase/migrations/20261026000006_crawler_state.sql`,
`scripts/{db-migrate,verify-live-db,live-audit-check}.mts`, `tests/unit/{crawler-parts,parse-page,crawl-engine,analyzer}.test.ts`,
`tests/db/audit.test.ts`, `tests/stubs/server-only.ts`.
Changed: `src/lib/navigation.ts` (audit/technical/pages live), `vitest.config.mts`, `package.json`, `.env.example`,
generated DB types, docs (ARCHITECTURE, DATABASE, SEO-SCORING, SECURITY, ROADMAP, ACADEMIC-DEMO, README).

### Database changes

Migration `20261026000006_crawler_state.sql` (applied to the live project): `crawl_jobs.phase/state/audit_id/heartbeat_at`;
`crawl_pages.fetch_state/attempts/found_in_sitemap/found_via_link/skip_reason` + frontier index;
`crawl_links.target_error` + index; `guard_issue_status` trigger; `crawl_compute_inbound(uuid)` (service role only).

### Tests performed

| Check | Result |
|---|---|
| `npm test` | **186 passed**, 13 files (new: crawler parts 17, parser 11, crawl engine 15, analyzer 12, audit DB 9) |
| Crawler protections | real local HTTP server on 127.0.0.1 is never hit; localhost, 169.254.169.254, 10.x, [::1] blocked; private links on crawled pages never fetched; page/depth caps; excludes; robots |
| Authorization | audit permissions (viewer/demo/inactive), issue status rules, DB: clients can't write crawl tables or mark issues fixed, outsiders see nothing, viewers can't change issues |
| API (running server) | tick/status without session → 401; bad id → 404; cron without/wrong secret → 401; audit page signed out → login redirect |
| Live end-to-end | `npm run audit:live-check -- https://books.toscrape.com/ 15`: 15 pages crawled and analyzed in ~20 s, score 74.6, 33 checks, 13 issues; findings spot-checked against the live HTML (empty meta description, H1→H3 skip, robots/sitemap 404, no canonical, no HTTP→HTTPS redirect) — all correct; temporary data deleted |
| `npm run db:migrate` | 0006 applied |
| `npm run lint` / `typecheck` / `build` | 0 problems / 0 errors / success |

### Known limitations

* The audit UI pages have **not been viewed in a browser while signed in** (requires the owner's account);
  they compile and their queries run against the live schema via the end-to-end script.
* No Playwright E2E yet.
* Gzipped sitemaps (`.xml.gz`) are skipped (reported). JavaScript-rendered content is not executed.
* Background progress without an open audit page needs a scheduler hitting `/api/cron/crawl`
  (Vercel Hobby allows only daily cron).
* Response times are measured from the crawler location (Rankora's server), not real users.
* `PAGESPEED_API_KEY` is not configured, so Core Web Vitals show "not applicable".
* Image file sizes are not measured (only presence of ALT and width/height attributes).

### Next tasks

1. Owner signs in and runs an audit on their own website from the UI; fix anything found.
2. Add a free PageSpeed Insights API key to enable Core Web Vitals.
3. Playwright E2E: register → onboarding → audit → issue → page detail.
4. Phase 3 — keywords & rank tracking (provider abstraction).

## Live database setup (2026-10-26)

* Supabase project `rankora` (region ap-southeast-1) created by the project owner; keys in `.env.local` (git-ignored).
* New scripts: `npm run db:migrate` (applies `supabase/migrations/*.sql`, records versions in
  `supabase_migrations.schema_migrations`, compatible with the Supabase CLI) and `npm run db:verify`
  (live checks inside a rolled-back transaction). Scripts now run with `tsx`.
* All 5 migrations applied to the live database.
* `npm run db:verify` — **15/15 passed** on the live database: 37 tables, RLS on every public table, 64 policies,
  plans seeded, profile trigger, owner sees own site, a second user cannot insert/update/delete another org's website,
  sees 0 rows of the other org in all 32 tenant tables, anon can read only plans, demo project created and labelled
  `demo`, demo invisible to other users. Nothing persisted.
* Data API check: publishable key reads `plans`; anon gets `permission denied` on `websites`.
* App rebuilt with real keys: register/login pages load without the "not configured" notice; `/app` redirects to
  `/login?next=/app` via the proxy.
* Not yet done: a real sign-up → onboarding → dashboard → Demo Project run in the browser (needs the owner to register).

## Phase 1b — Foundation completion (2026-10-26)

### Completed

* **Password reset**: `/forgot-password` (no account enumeration) → recovery link via `/auth/callback` →
  `/reset-password` (requires the recovery session, password + confirmation). "Forgot password?" link on sign-in.
* **Account settings** (`/app/[org]/account`): edit name, change password, list of your organizations and roles.
  Linked from the user menu.
* **Top navigation**: website selector moved to the top bar (keeps the current module when switching sites);
  user menu with Account settings and Sign out. Sidebar keeps the organization switcher and module navigation.
* **Demo Project**: "Open Demo Project" on onboarding and in the organization switcher. Creates one separate demo
  organization per user with a fictional `.example` store, a site audit scored by the real engine, 90 days of
  Search Console / organic traffic sample data, query/page breakdowns and 10 tracked keywords with rank history.
  Purple banner on every demo page and **Demo Data** badges on every card, chart and table fed by demo rows.
  Demo workspace is read-only for websites; the owner can remove it from Organization settings.
* **Dashboard** now covers every metric in the brief, each with an empty state until real or demo data exists:
  SEO health score, critical/warning/opportunity issues, tracked pages, clicks, impressions, CTR, average position,
  organic sessions and users (with change vs previous 28 days), search performance trend, organic traffic trend,
  keyword ranking trend (keywords in top 10 per day), tracked keywords with improved/dropped/new/lost and
  Top 3/10/20/100 distribution, top queries, top pages, recent issues, recommended actions.

### Files changed

New: `src/app/(auth)/forgot-password/page.tsx`, `src/app/(auth)/reset-password/page.tsx`,
`src/app/app/[org]/account/{page,profile-form}.tsx`, `src/app/onboarding/demo/page.tsx`,
`src/components/app/site-switcher.tsx`, `src/lib/demo/generate.ts`, `src/lib/dashboard/metrics.ts`,
`supabase/migrations/20261026000005_demo_project.sql`, `tests/db/demo.test.ts`, `tests/unit/demo.test.ts`,
`tests/unit/dashboard-metrics.test.ts`.
Changed: `src/app/(auth)/{actions,auth-forms}.ts(x)`, `src/app/app/[org]/layout.tsx`, `…/settings/page.tsx`,
`…/websites/page.tsx`, `…/websites/new/page.tsx`, `…/sites/[site]/dashboard/page.tsx`, `src/app/onboarding/page.tsx`,
`src/components/app/{sidebar,user-menu}.tsx`, `src/lib/actions/workspace.ts`, `src/lib/validation/schemas.ts`,
`src/lib/supabase/database.types.ts` (regenerated), `tests/db/rls.test.ts`, `tests/unit/validation.test.ts`, docs.

### Database changes

Migration `20261026000005_demo_project.sql`: `create_demo_project(jsonb)` (SECURITY DEFINER, one per user,
forces demo flags and `source = 'demo'`, ignores payload ids, size caps, granted to `authenticated` only);
`websites_insert` policy now also rejects inserts into demo organizations. No new tables (still 37).

### Tests performed

| Check | Result |
|---|---|
| `npm test` | **122 passed**, 8 files |
| New: all-table isolation | for every table with `organization_id` (≥ 26 tables), another user sees **0** of Alice's rows |
| New: demo project (DB) | creates demo org/site owned by caller; all metric rows `demo`; stored score = engine score; 33 checks; idempotent; invisible to other users; real sites can't be added; oversize payload and anonymous calls rejected; owner removal cascades everything |
| New: demo payload (unit) | deterministic, `.example` domain, score recomputes identically, size limits, consistent metrics |
| New: dashboard metrics (unit) | top-N aggregation with weighted position, improved/dropped/new/lost, distribution, top-10 per day |
| New: password schema | mismatch, weak password |
| `npm run lint` | 0 problems |
| `npm run typecheck` | 0 errors |
| `npm run build` | success, 30 routes |
| Browser smoke (no Supabase keys) | login shows "Forgot password?"; `/forgot-password` renders; `/reset-password` without a session shows "link invalid or expired"; `/onboarding/demo` redirects to login with `next` |

### Known limitations

* Still **not run against a live Supabase project**: the signed-in pages (dashboard, demo, account, onboarding) build and
  their SQL is tested in PGlite, but have not been rendered with real auth.
* The password-reset email flow depends on Supabase email settings (Site URL, redirect URLs, SMTP for production volume).
* Dashboard aggregates top queries/pages in the app from at most 5,000 rows; a SQL aggregate (RPC/view) is needed for large sites.
* No email change, MFA or team invitations yet.

### Next tasks

1. Apply migrations to a Supabase project; run register → onboarding → dashboard → Demo Project → reset password end to end.
2. Add Playwright E2E for those flows.
3. Start Phase 2 (crawler and site audit).

## Phase 1 — Foundation (2026-10-26)

### Completed

* **Project setup**: Next.js 16.4 App Router, React 19, TypeScript strict, Tailwind 4, ESLint, Vitest.
  Cache Components disabled on purpose (see ARCHITECTURE). Security headers in `next.config.ts`.
* **Database**: 4 migrations covering all 30 required tables plus `plans`, `platform_admins`, `system_events`,
  `crawl_links`, `seo_issue_pages`, `oauth_states` and `keyword_research_queries` (37 public tables).
  RLS on every table, `private` helper functions, column grants, composite tenant FKs, triggers
  (profile on signup, website settings, last-owner guard, owner-grant guard, task assignee check,
  `completed_at`), RPCs `create_organization` and `rate_limit_hit`, seeded plan catalog.
* **Generated DB types** from the migrations (`npm run db:types`).
* **Auth**: register, sign in, sign out, email confirmation callback, session refresh in `proxy.ts`,
  open-redirect-safe `next` handling, "Supabase not configured" state.
* **Data Access Layer** with role checks (`requireOrg`, `requireWebsite`).
* **Onboarding**: organization → website (country, language, preferred domain, DNS + SSRF validation,
  plan limit) → next steps → dashboard.
* **App shell**: dark sidebar with org switcher, site switcher, grouped modules (built vs "Soon"),
  mobile drawer, user menu, loading skeleton and error boundary.
* **Pages**: site dashboard (real data only; integration-aware empty states, Demo Data labelling built in),
  websites list, add website, site settings (details, crawl configuration, delete with confirmation),
  organization settings (rename, members), plan & billing (limits, usage), admin console (gated, aggregates only),
  honest "Planned · Phase N" page for every unbuilt module.
* **Marketing site**: home, features, SEO Audit, Keyword Research, Analytics, Rank Tracking, pricing, about, contact.
* **Core libraries**: SSRF-safe URL validation and fetch (connect-time DNS check, manual redirects, limits),
  AES-256-GCM token encryption, SEO rule catalog (33 rules) and weighted scoring engine.
* **Design system**: semantic tokens, Button, Card, Badge (severity, Demo Data), form controls with errors,
  StatCard, ScoreRing, Empty / Error / Planned states, Skeleton, PageHeader, Recharts TrendChart.
* **Docs**: README, ARCHITECTURE, DATABASE, SEO-SCORING, INTEGRATIONS, SECURITY, ROADMAP, ACADEMIC-DEMO, PROGRESS.

### Files changed

`package.json`, `next.config.ts`, `tsconfig.json`, `vitest.config.mts`, `.env.example`, `.gitignore`,
`supabase/migrations/*.sql`, `scripts/gen-db-types.mts`, `src/proxy.ts`, `src/app/**`, `src/components/**`,
`src/lib/**`, `tests/**`, `docs/**`, `README.md`.

### Database changes

Initial schema (migrations `20261025000001` to `20261025000004`). Not yet applied to a hosted Supabase project.

### Tests performed

| Check | Result |
|---|---|
| `npm test` (Vitest) | **100 passed** — 5 files: scoring (11), url-safety (43), crypto (5), validation (23), RLS/DB (18) |
| RLS suite on PGlite (Postgres 17) | migrations apply cleanly; tenant isolation, viewer read-only, owner guards, token column protection, anon lockout, rate limiting all verified |
| `npm run lint` | 0 problems |
| `tsc --noEmit` | 0 errors |
| `npm run build` | success (26 routes) |
| Browser smoke test (no Supabase keys) | home, login, register render; protected route redirects to login; no horizontal scroll at 375 px |

A test caught one real bug during the phase: emails with surrounding whitespace failed validation
because the email check ran before trimming. Fixed.

### Known limitations

* **Not yet tested against a live Supabase project.** Sign-up, onboarding and the authenticated pages
  compile and the SQL is verified in PGlite, but the end-to-end flow has not been run with real auth.
  PGlite stubs `auth.users`/`auth.uid()`; Supabase-specific behaviour (e.g. default grants) may differ slightly.
* No end-to-end (Playwright) tests yet — planned for Phase 2 once a Supabase test project is available.
* Audit, keywords, rankings, GSC, GA4, content, tasks, competitors, backlinks and reports are schema-only
  and show "Planned" pages.
* `audit_logs` writes are skipped when `SUPABASE_SECRET_KEY` is not set.
* No team invitations, CSP, MFA or dark mode yet.
* The Demo Project is not seeded yet (Phase 2).

### Next tasks (Phase 2 — Crawler & Site Audit)

1. Apply migrations to a Supabase project and run the auth/onboarding flow end to end.
2. Crawl job creation action (role + plan + rate limit) and cron worker with `SKIP LOCKED` batches.
3. robots.txt parser, sitemap.xml parser (index + gzip), URL normalisation, frontier with depth/page limits.
4. Cheerio page analyzer and the 33 rule evaluators; persist checks, score and issue lifecycle.
5. Site Audit, Technical SEO and Pages UIs; PageSpeed Insights client.
6. Demo Project seed script (labelled `demo` source).
7. Crawler tests against fixture HTML and a local test server; Playwright E2E for auth + onboarding.
