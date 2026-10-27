# Rankora — Integrations

All provider calls happen **server-side**. Credentials live only in server environment variables
(`.env.local` locally, Vercel project settings in production). Nothing here is prefixed `NEXT_PUBLIC_`.

| Integration | Status | Needs | Env vars |
|---|---|---|---|
| Supabase (auth + DB) | ✅ Phase 1 | Supabase project (free tier works) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| Site crawler | Phase 2 | nothing external | — |
| Google PageSpeed Insights | Phase 2 | free Google Cloud API key | `PAGESPEED_API_KEY` |
| Google Search Console | ✅ Phase 4 | Google Cloud OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` |
| Google Analytics 4 (Data + Admin API) | ✅ Phase 4 | same OAuth client | same |
| Keyword data (volume, CPC, difficulty, ideas) | Phase 3 | paid provider, e.g. DataForSEO | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| SERP rank checks | Phase 3 | paid provider, e.g. DataForSEO | same |
| Backlinks | Phase 6 | paid provider, e.g. DataForSEO Backlinks | same |
| AI content suggestions | Phase 5 | LLM API (Claude) | `ANTHROPIC_API_KEY` |
| Payments | Phase 7 | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

## Google Search Console + GA4 (implemented in Phase 4)

Code: `src/lib/google/` (oauth, connections, search-console, analytics, sync, errors), routes under
`src/app/api/integrations/`, UI in `sites/[site]/integrations`, `search-performance`, `analytics`.

### Setup (Google Cloud)

1. Create (or reuse) a Google Cloud project and an **OAuth client → Web application**.
2. Authorized redirect URI: `<NEXT_PUBLIC_SITE_URL>/api/integrations/google/callback`
   (locally `http://localhost:3000/api/integrations/google/callback`).
3. Enable APIs: **Google Search Console API**, **Google Analytics Data API**, **Google Analytics Admin API**.
4. OAuth consent screen: add the read-only scopes below; while the app is in *Testing*, add your Google account as a test user.
5. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` (and `SUPABASE_SECRET_KEY`) on the server.

The same OAuth client can also be used for “Sign in with Google” in Supabase; add both redirect URIs.

### Flow

Scopes (read-only only): `openid email https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly`.

1. `GET /api/integrations/google/start?site=…&services=gsc,ga4` — user must be **member+** of the website (RLS lookup),
   not a demo site; rate limited (10/h). Creates a random `state` (stored only as SHA-256) and a **PKCE S256** verifier
   (stored encrypted), bound to user + organization + website, 10-minute expiry. Redirects to Google with
   `access_type=offline&prompt=consent`.
2. `GET /api/integrations/google/callback` — rejects unknown, expired, reused, wrong-provider or **different-user** states;
   claims the state atomically (single use); re-checks the user is still member+ of the website; exchanges the code with
   the verifier; stores access + refresh tokens **AES-256-GCM encrypted** in `oauth_connections` (one per organization +
   Google account); creates/updates `integrations` rows as `pending`.
3. The user picks a property on the Integrations page. The value is **re-validated against the live list from Google**
   before it is saved, then an initial sync (180 days) is queued.
4. Sync runs in time-boxed steps (`POST /api/integrations/[id]/sync` while the page is open, and `GET /api/cron/google-sync`
   daily with `Bearer CRON_SECRET` for the last 5 days).
5. Tokens refresh automatically 2 minutes before expiry. A revoked/invalid refresh token marks the connection `expired`,
   wipes the access token and flags every affected integration with a “Reconnect” message.
6. “Disconnect from this website” detaches one integration (optionally deleting imported data); “Revoke access” (admins)
   revokes the token at Google and deletes the ciphertext for the whole organization.

### Data stored (normalized, `source = 'gsc' | 'ga4'`)

| Step | API call | Table / rows |
|---|---|---|
| gsc_totals | searchAnalytics.query `[date]` | `search_console_daily` device=all, country=all |
| gsc_devices / gsc_countries | `[date, device]` / `[date, country]` | `search_console_daily` per device / country |
| gsc_queries / gsc_pages | `[date, query]` / `[date, page]` (paged, ≤ 50k rows) | `search_console_queries` / `search_console_pages` |
| ga_totals / ga_channels / ga_devices / ga_countries | runReport `[date(, dimension)]` | `analytics_daily` (`all` = roll-up) |
| ga_pages / ga_landing | runReport `[date, pagePath]` / `[date, landingPage]` | `analytics_pages` (`is_landing`) |

Views aggregate in SQL (`gsc_breakdown`, `ga_breakdown`, SECURITY INVOKER so RLS applies), which also avoids the Data
API 1,000-row response cap.

### Error handling

| Situation | What the user sees |
|---|---|
| Not configured on server | setup card with the exact env vars and redirect URI |
| Not connected / disconnected | “Connect Google account” on Integrations; connect prompt on Analytics / Search Performance |
| Connected, no property chosen | “Choose a property” |
| No properties on the account | how to verify a site in Search Console / create a GA4 property |
| Token expired or revoked | “Google access expired or was revoked. Reconnect…” plus a Reconnect button |
| Permission lost / property removed | specific message; choose another property |
| 429 / 5xx / network | automatic retry after 60 s with a rate-limit message; sync resumes at the failed step |
| First import running | progress bar on Integrations; “First import in progress” on data pages |
| No data in range | per-chart / per-table empty states (no zero-filled fake days) |

### Notes

* GA4 “Users” across several days are summed daily unique users (a returning person can count more than once); the UI says so.
* Search Console hides anonymized queries, so the query table can total less than the overview.
* Nothing is shown as Google data unless it came from these API calls; Demo Project rows are `source = 'demo'` and badged.

## Provider abstraction

Implemented in Phase 3 (`src/lib/providers/`):

```ts
interface KeywordProvider { id; name; ideas(seed, market, opts); metrics(keywords, market) }
interface RankProvider    { id; name; supports(engine); check({ keyword, countryCode, languageCode, device, engine, domain, depth }) }
```

* `registry.ts` returns the **DataForSEO** adapter when `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` are set, otherwise
  `null` → the UI shows **“Provider Not Connected”** and metric fields stay empty (`—`).
* The demo keyword provider is returned **only** for `websites.is_demo = true`; rank checks never use demo data
  (the Demo Project's rankings are pre-seeded snapshots labelled `demo`).
* Fields a provider does not return are stored as `NULL`, never defaulted. Intent shown without provider data is a
  clearly marked “rule-based” label computed from the keyword text and is never stored as provider data.
* Metrics and positions are written only by the server (service role). Clients cannot write `search_volume`, `cpc`,
  `difficulty`, `intent`, positions or `keyword_rankings` (column grants + RLS, tested).
* Every metric row records its source (`metrics_source`, `rank_source`, `keyword_rankings.source`, research `provider`).

### DataForSEO endpoints used

| Feature | Endpoint | Notes |
|---|---|---|
| Keyword ideas | `dataforseo_labs/google/related_keywords/live` + `keyword_suggestions/live` | merged, de-duplicated, up to 150 ideas |
| Metrics refresh | `dataforseo_labs/google/keyword_overview/live` | up to 700 keywords per market per call |
| Rank check | `serp/{google,bing}/organic/live/advanced` | depth 100, organic results only, subdomains count |

Locations use Google Ads geo IDs (`2000 + ISO 3166 numeric`, e.g. US = 2840).

### Cost controls

* Research results are cached 7 days per organization/seed/market (`keyword_research_queries`); cache hits are free.
* `keyword_lookups_per_month` (plan) enforced from `usage_records`; research is also rate-limited (30/hour/user).
* Rank checks: once per keyword per day (unique `(keyword_id, checked_on)`), keywords are **claimed** before a
  provider call so concurrent workers never pay twice; `tracked_keywords` plan limit enforced when tracking.
* Daily checks run via `/api/cron/ranks` (Bearer `CRON_SECRET`) or the “Check now” button (`POST /api/sites/[id]/rank-check`).

### CSV

* Import (`importKeywordsAction`): keyword, country, language, device, target_url, group — max 500 rows, 1 MB, validated
  per line with line-numbered errors. Metric columns in a file are ignored by design.
* Export: `/api/sites/[id]/keywords/export` (all / group / tracked) and `/api/keyword-research/[queryId]/export`.
  Cells are escaped against spreadsheet formula injection; demo exports are named `…-DEMO-DATA.csv`.

## Competitor data and backlinks (Phase 6)

```ts
interface RankQuery { …; competitors?: string[] }          // competitor positions read from the SAME SERP response
interface DomainKeywordProvider { rankedKeywords(domain, market, { limit }) }
interface BacklinkProvider { summary(target); backlinks(target, { limit, status: 'live' | 'lost' }) }
```

| Feature | DataForSEO endpoint | Notes |
|---|---|---|
| Competitor positions | `serp/{engine}/organic/live/advanced` (existing rank check) | no extra call; organic results only; subdomains count |
| Overlap & gaps | `dataforseo_labs/google/ranked_keywords/live` | `keyword_data.keyword`, `keyword_info.search_volume/cpc`, `ranked_serp_element.serp_item.rank_group/url`; 1,000 per domain, cached 7 days |
| Backlink summary | `backlinks/summary/live` | `backlinks`, `referring_domains`, `referring_main_domains`, `referring_ips`, `broken_backlinks`, `rank` |
| Backlinks | `backlinks/backlinks/live` | `backlinks_status_type` live (1,000) and lost (200); `url_from`, `domain_from`, `url_to`, `anchor`, `dofollow`, `attributes`, `item_type`, `domain_from_rank`, `first_seen`, `last_seen`, `is_new`, `is_lost`; `rank_scale: one_hundred` |

* `getDomainKeywordProvider()` uses the DataForSEO credentials. `getBacklinkProvider()` additionally requires
  `BACKLINK_PROVIDER=dataforseo`, because the Backlinks API is a separate subscription.
* Field names follow the DataForSEO v3 documentation (checked 2026-10-28); parsers are fixture-tested, but not yet run
  against the live API.

## AI suggestions (optional, Phase 5)

`src/lib/ai/` holds a provider-neutral interface, `AiProvider.generate(task, context)`, for six tasks: `titles`, `meta_descriptions`,
`outline`, `faqs`, `improvements`, `internal_links`. The registry returns the **Claude** adapter when `ANTHROPIC_API_KEY` is set
(model `claude-opus-5-5`, override with `ANTHROPIC_MODEL`). Without it, it returns `null` and the UI shows **“AI provider not connected”**.
The rule-based Content Optimizer works without AI.

* **Structured output**: each task has a zod schema sent as `output_config.format`. The response is JSON-parsed and validated
  server-side, and refusals (`stop_reason: "refusal"`), truncation and API errors map to typed, user-safe messages.
* **Grounding**: the prompt contains the analysis (failing checks, missing related terms), the heading outline and up to 24,000
  characters of page text fenced as untrusted data. The system prompt forbids invented facts, statistics, prices and ranking promises.
* **Post-processing** (`sanitizeOutput`): lengths and counts are capped, and internal-link targets are kept only when they are in
  the crawled candidate list and not already linked. The model cannot introduce URLs.
* **Labelling**: results are stored in `content_analyses.ai_suggestions[task]` with `label: "AI suggestion"`, provider, model and
  timestamp, and are rendered with an “AI suggestion” badge. They are never published, and Rankora has no write access to user websites.
* **Cost controls**: on demand only (one button per task), 30 requests/hour/user (`rate_limit_hit('ai.suggest')`), one call per
  request, cached system prompt. Another provider can be added by implementing `AiProvider` and returning it from `registry.ts`.

## Demo Mode (implemented)

* Entry points: "Open Demo Project" on the onboarding page and "+ Open Demo Project" in the organization switcher (`/onboarding/demo`).
* `buildDemoPayload()` (`src/lib/demo/generate.ts`) produces a deterministic sample dataset: a fictional store on a reserved
  `.example` domain, a site audit whose score is computed by the **real scoring engine** from sample rule results,
  90 days of Search Console and organic traffic figures, 28 days of query/page rows, and 10 tracked keywords with 30 days of rank history.
* The `create_demo_project` database function writes it into a new demo organization (`is_demo = true`) on a demo website
  (`is_demo = true`), with every metric row `source = 'demo'`. One per user; the owner can remove it from Organization settings.
* The UI shows a purple banner on every page of the demo workspace and a **Demo Data** badge on every card, chart and table fed by demo rows.
* The demo workspace is read-only for websites: real websites cannot be added to it (RLS + server action), and demo site settings are disabled.
