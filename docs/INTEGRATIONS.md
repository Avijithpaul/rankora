# Rankora — Integrations

All provider calls happen **server-side**. Credentials live only in server environment variables
(`.env.local` locally, Vercel project settings in production). Nothing here is prefixed `NEXT_PUBLIC_`.

| Integration | Status | Needs | Env vars |
|---|---|---|---|
| Supabase (auth + DB) | ✅ Phase 1 | Supabase project (free tier works) | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| Site crawler | Phase 2 | nothing external | — |
| Google PageSpeed Insights | Phase 2 | free Google Cloud API key | `PAGESPEED_API_KEY` |
| Google Search Console | Phase 4 | Google Cloud OAuth client | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `TOKEN_ENCRYPTION_KEY` |
| Google Analytics 4 (Data API) | Phase 4 | same OAuth client | same |
| Keyword data (volume, CPC, difficulty, ideas) | Phase 3 | paid provider, e.g. DataForSEO | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD` |
| SERP rank checks | Phase 3 | paid provider, e.g. DataForSEO | same |
| Backlinks | Phase 6 | paid provider, e.g. DataForSEO Backlinks | same |
| AI content suggestions | Phase 5 | LLM API (Claude) | `ANTHROPIC_API_KEY` |
| Payments | Phase 7 | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` |

## Google OAuth flow (Search Console + GA4) — design

Scopes (read-only): `https://www.googleapis.com/auth/webmasters.readonly`,
`https://www.googleapis.com/auth/analytics.readonly`, plus `openid email`.

1. `GET /api/integrations/google/start?site=…` — user must be `member+` on the site.
   Generate `state` (32 random bytes) and a PKCE verifier. Store **SHA-256(state)**, the encrypted verifier,
   user, organization, site and a 10-minute expiry in `oauth_states`. Redirect to Google with
   `access_type=offline&prompt=consent`.
2. `GET /api/integrations/google/callback` — look up `oauth_states` by hash; reject if missing, expired,
   already used, or for a different signed-in user. Mark it used, exchange the code with the verifier.
3. Encrypt access and refresh tokens with AES-256-GCM (`src/lib/security/crypto.ts`) and store them in
   `oauth_connections`. Token columns are never selectable by clients.
4. The user picks the GSC property / GA4 property → `integrations` row (`status = connected`).
5. A daily sync job pulls data into `search_console_*` / `analytics_*` with `source = 'gsc' | 'ga4'`.
   Refresh failures set `status = error` with `last_error` and surface a reconnect prompt.
6. Disconnect revokes the token at Google, sets `revoked_at` and deletes the ciphertext.

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

## Demo Mode (implemented)

* Entry points: "Open Demo Project" on the onboarding page and "+ Open Demo Project" in the organization switcher (`/onboarding/demo`).
* `buildDemoPayload()` (`src/lib/demo/generate.ts`) produces a deterministic sample dataset: a fictional store on a reserved
  `.example` domain, a site audit whose score is computed by the **real scoring engine** from sample rule results,
  90 days of Search Console and organic traffic figures, 28 days of query/page rows, and 10 tracked keywords with 30 days of rank history.
* The `create_demo_project` database function writes it into a new demo organization (`is_demo = true`) on a demo website
  (`is_demo = true`), with every metric row `source = 'demo'`. One per user; the owner can remove it from Organization settings.
* The UI shows a purple banner on every page of the demo workspace and a **Demo Data** badge on every card, chart and table fed by demo rows.
* The demo workspace is read-only for websites: real websites cannot be added to it (RLS + server action), and demo site settings are disabled.
