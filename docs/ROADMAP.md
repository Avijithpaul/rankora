# Rankora — Roadmap

| Phase | Scope | External services | Status |
|---|---|---|---|
| **1. Foundation** | Next.js app, design system, full DB schema + RLS, auth, onboarding, org/website CRUD, app shell, dashboard (real-data only), marketing site, SSRF + crypto + scoring libraries, tests, docs | Supabase | ✅ Done |
| **2. Crawler & Site Audit** | Job queue + cron worker, robots.txt, sitemap.xml, link crawling with limits, page analyzer, 33 rule evaluators, score persistence, issue lifecycle, Site Audit / Technical SEO / Pages UIs, PageSpeed Insights, Demo Project seeding, Playwright E2E | PageSpeed API key (free) | ✅ Done (Playwright E2E still open) |
| **3. Keywords & Rank Tracking** | Provider interfaces + DataForSEO adapter, keyword research, saved lists, groups/clusters, target URL mapping, CSV export, daily rank snapshots, history charts, distribution, movers | Keyword/SERP provider (paid) | ✅ Done (architecture + UI; live data needs DataForSEO credentials) |
| **4. Google Integrations** | OAuth (state + PKCE, encrypted tokens), property selection, GSC + GA4 sync jobs, Search Performance and Analytics pages, date comparison, Integrations page | Google Cloud OAuth client (free) | ✅ Done (live Google data needs OAuth credentials) |
| **5. Page SEO & Content** | Page Explorer (crawl + GSC + GA4 + keywords + issues + recommendations), Content Optimizer (URL or draft, 21 checks, semantic coverage, readability), history, optional labelled AI suggestions | Optional Anthropic API key | ✅ Done (live AI needs `ANTHROPIC_API_KEY`) |
| **6. Competitors, Backlinks, Tasks** | Competitor domains, same-SERP ranking comparison, keyword overlap/gaps, homepage & page comparison, backlink provider abstraction (backlinks, referring domains, anchors, new/lost), SEO task board from issues, dashboard progress | Keyword/SERP + Backlink provider (paid) | ✅ Done (live provider data needs DataForSEO credentials) |
| **7. Reporting & Academic Demo** | Six report types, date range + comparison, website selection, printable page, JSON/CSV export, PDF export architecture, Academic Demo page, project documentation | — | ✅ Done (server-side PDF renderer not configured) |
| **8. SaaS readiness** | Free/Starter/Pro/Agency plans, entitlements and usage limits (also in the database), subscription model, billing provider abstraction (manual active, Stripe built but not activated), upgrade UI, team invitations and roles, notifications, audit/activity log, admin monitoring, error logging, rate limits, security review, E2E + responsive QA, production readiness report | Stripe (not activated) | ✅ Done — see docs/PRODUCTION-READINESS.md |
| **9. Launch** | Activate Stripe (with approval), email provider (invites, notifications, digests), script-nonce CSP, MFA, external error tracking, account deletion + data export, privacy/terms, Google consent screen verification, CI for E2E, scheduled reports | Stripe, email provider, Sentry | |

## Later ideas

* Scheduled crawls with change alerts (new critical issues, ranking drops).
* Bing Webmaster Tools integration.
* Shared read-only report links with expiring tokens.
* Log-file analysis for crawl budget.
