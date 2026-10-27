# Rankora — Roadmap

| Phase | Scope | External services | Status |
|---|---|---|---|
| **1. Foundation** | Next.js app, design system, full DB schema + RLS, auth, onboarding, org/website CRUD, app shell, dashboard (real-data only), marketing site, SSRF + crypto + scoring libraries, tests, docs | Supabase | ✅ Done |
| **2. Crawler & Site Audit** | Job queue + cron worker, robots.txt, sitemap.xml, link crawling with limits, page analyzer, 33 rule evaluators, score persistence, issue lifecycle, Site Audit / Technical SEO / Pages UIs, PageSpeed Insights, Demo Project seeding, Playwright E2E | PageSpeed API key (free) | ✅ Done (Playwright E2E still open) |
| **3. Keywords & Rank Tracking** | Provider interfaces + DataForSEO adapter, keyword research, saved lists, groups/clusters, target URL mapping, CSV export, daily rank snapshots, history charts, distribution, movers | Keyword/SERP provider (paid) | ✅ Done (architecture + UI; live data needs DataForSEO credentials) |
| **4. Google Integrations** | OAuth (state + PKCE, encrypted tokens), property selection, GSC + GA4 sync jobs, Search Performance and Analytics pages, date comparison, Integrations page | Google Cloud OAuth client (free) | ✅ Done (live Google data needs OAuth credentials) |
| **5. Content & Tasks** | Content Optimizer (URL or draft), AI suggestion architecture (clearly labelled), issue → task conversion, task board with assignees and due dates | Optional LLM API | |
| **6. Competitors, Backlinks, Reports** | Competitor domains, overlap/gap, audit comparison, backlink module (provider only), report builder, printable view, PDF export | Backlink provider (paid) | |
| **7. SaaS hardening** | Team invitations, notifications, admin console, Stripe billing, usage metering UI, CSP, MFA, dark mode, observability | Stripe, email provider | |

## Later ideas

* Scheduled crawls with change alerts (new critical issues, ranking drops).
* Bing Webmaster Tools integration.
* Shared read-only report links with expiring tokens.
* Log-file analysis for crawl budget.
