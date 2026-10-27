# Rankora — Production Readiness Report

Audit date: 2026-10-28 (Phase 8). Scope: the whole application, assessed as a commercial multi-tenant SaaS.
Every status below is backed by an automated test, a live check against the Supabase project, or the
security review. Items that are not verified say so.

## Verification summary

| Check | Result |
|---|---|
| ESLint | clean |
| TypeScript (`next typegen && tsc --noEmit`, strict) | clean |
| Unit tests (Vitest) | 18 files, all pass |
| Integration tests — database (PGlite with the real migrations: RLS, grants, triggers, functions) | 9 files, all pass |
| **Total Vitest** | **347 tests in 27 files** |
| E2E (Playwright, Microsoft Edge, production build on localhost, temporary accounts) | **15 tests, all pass** |
| Responsive QA | 5 public + 6 signed-in pages × 375 / 768 / 1440 px: no horizontal scroll, screenshots reviewed |
| Production build (`next build`) | succeeds |
| Live database verification (`db:verify`, 43 tables, RLS on all) | passes |
| Live integration checks: audit, keywords, Google (simulated), content, competitors/backlinks/tasks, reports | all pass |
| `npm audit --omit=dev` (shipped dependencies) | 0 vulnerabilities (2 moderate in dev-only test tooling) |
| Security review (independent read-only reviewer + fixes) | 0 critical; 3 medium/low findings fixed, 1 false positive, rest documented below |

## Status by area

### ✅ Ready

| Area | Notes |
|---|---|
| Authentication | Email/password, password reset, Google and GitHub sign-in (providers enabled in Supabase and verified to redirect correctly). JWT verified with `getClaims()`. |
| Multi-tenancy & authorization | RLS on all 43 tables; DAL role checks; composite tenant FKs; tenant isolation covered by DB tests and E2E (an outsider gets 404). |
| Roles & team members | Owner, admin, member and viewer roles. Invite → accept (one-time, hashed token, 7-day expiry, confirmed email must match), role change, remove, leave. Only owners can grant, demote or remove owners; the last owner is protected. E2E covered. |
| Plan entitlements & usage limits | Free / Starter / Pro / Agency limits for websites, members, crawled pages per month, tracked keywords, rank checks, reports and AI credits. Websites, members, tracked keywords and competitors are also enforced **in the database** (direct API calls cannot bypass them). |
| Usage tracking | Metered `usage_records`; `usage_summary()`. Admins are notified once at 80 % and 100 % of a monthly limit. |
| Subscription model | `subscriptions` is the single source of truth; `organizations.plan_id` is derived by trigger, and canceled falls back to Free. |
| Upgrade UI | Billing page with usage meters, four plans and upgrade buttons. Buttons are disabled with an explanation while payments are off. |
| Notifications | In-app bell with unread count. Events: task assigned, audit finished, member joined, role changed, plan changed, usage thresholds. |
| Audit logs | Plan, member, invite, integration, website, competitor and AI events. Activity log visible to org admins. |
| Admin monitoring | `/admin` (hidden 404 for non-admins): signups, organizations, failed or stuck crawls, integrations in error, failed billing events, subscriptions by plan, platform usage, recent warnings/errors, configuration status, and audited manual plan changes (superadmin). |
| Error handling | Route error boundaries plus a root `global-error`. Internal errors are logged to `system_events` with secrets redacted. Users see generic messages and a reference digest. |
| Rate limiting | DB-backed per-user buckets on every expensive or abusable action: audits, keyword research, content, AI, competitors, backlinks, reports, invites, checkout, Google property selection and sync. |
| Site audit / crawler, Page Explorer, Content Optimizer (rule-based), tasks, reports (print, JSON/CSV) | Verified live against real websites. |
| Security hardening | SSRF-safe fetching; PKCE OAuth with AES-GCM encrypted tokens; column grants; security headers incl. CSP `frame-ancestors`/`base-uri`/`object-src`, HSTS, COOP; CSV formula-injection protection. |
| Academic demo | Demo Project (labelled Demo Data), `/academic-demo`, `/project`, docs. |

### 🟡 Partially ready

| Area | What works | What is missing |
|---|---|---|
| Billing provider abstraction | `BillingProvider` interface. A manual provider is active (no payments; superadmins change plans, with audit). A Stripe adapter is implemented: checkout, portal, signature-verified idempotent webhook, event mapping. All unit-tested with fixtures. | Never run against Stripe; no Stripe credentials or price IDs. **Real payments are deliberately not activated** (needs credentials *and* `BILLING_LIVE_APPROVED=true`). No invoices or tax handling in-app. |
| Team invitations | Invitation link shown once to the inviter to share. | No email delivery (needs an email provider). Registration does not return to the invite link automatically. |
| Content Security Policy | Framing, base-uri and object-src restricted. | No `script-src` with nonces yet. |
| Report export | JSON, CSV, browser print-to-PDF. | Server-side PDF renderer (architecture only). |
| Monitoring | In-app system events and admin dashboard. | No external error tracker or uptime alerting (e.g. Sentry, status page). |
| Background jobs | Crawl, rank and Google-sync ticks; cron endpoints protected by a secret. | Needs a scheduler in production (Vercel Cron or similar). Vercel Hobby runs crons at most daily. |
| GDPR / compliance | Data is isolated per tenant; users can leave organizations and delete websites. | No account self-deletion, data export, privacy policy or terms pages. |

### ⛔ Blocked

| Item | Blocked by |
|---|---|
| Taking real payments | Stripe account, price IDs, webhook endpoint and your explicit approval (`BILLING_LIVE_APPROVED=true`). |
| Google OAuth consent screen in production mode | Public domain, privacy policy URL and Google verification (testing mode works for test users only). |
| Sending invitation and notification emails | Choice and credentials of an email provider (e.g. Resend, Postmark, SES). |

### 💳 Requires a paid API

| Feature | Provider |
|---|---|
| Keyword research volumes, CPC, difficulty | DataForSEO Labs |
| Daily rank tracking and competitor SERP positions | DataForSEO SERP API |
| Competitor keyword overlap and gaps | DataForSEO Labs `ranked_keywords` |
| Backlinks, referring domains, anchors, new/lost | DataForSEO Backlinks API (separate subscription; `BACKLINK_PROVIDER=dataforseo`) |
| AI suggestions (titles, meta, outlines, FAQs, improvements, internal links) | Anthropic API (`ANTHROPIC_API_KEY`) |

Without these, each module shows "Provider Not Connected" or "AI provider not connected". No numbers are invented.

### 🔑 Requires credentials (free)

| Feature | Credential |
|---|---|
| Search Console and GA4 data | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` and `TOKEN_ENCRYPTION_KEY` (OAuth client in Google Cloud) |
| Core Web Vitals in audits | `PAGESPEED_API_KEY` |
| Scheduled jobs | `CRON_SECRET` and a scheduler |
| Production site URL | `NEXT_PUBLIC_SITE_URL` (must be set in production; also used for invite links) |

### 🚀 Future enhancements

* Script-nonce CSP; MFA; SSO/SAML for Agency; session management UI.
* Email notifications and digests; scheduled monthly reports by email; Slack webhooks.
* Usage-based overage billing; annual plans; coupons; tax (Stripe Tax); invoices page.
* Organization-wide report roll-ups; white-label reports for agencies; server-side PDF renderer.
* Account deletion and data export; privacy and terms pages; cookie consent if analytics are added.
* External observability (Sentry or OpenTelemetry), uptime monitoring, alerting on stuck crawls.
* Playwright E2E in CI with a dedicated Supabase test project.
* Bing Webmaster Tools; log-file analysis; change alerts.

## Security review

An independent read-only review covered authorization/IDOR, RLS and grants, SECURITY DEFINER functions, filter
injection, redirects, XSS, SSRF, secrets, cron/OAuth, rate limits and error leakage. Findings and outcomes:

| # | Finding | Severity | Outcome |
|---|---|---|---|
| 1 | Plan limits (websites, tracked keywords, competitors) and the website URL/domain rule were enforced only in server actions; the Data API could bypass them (e.g. point `base_url` at another domain). | Medium | **Fixed**: database triggers enforce the limits for members, `base_url` must be on the website's domain, and outsiders are left to RLS. DB-tested. |
| 2 | Any member could attach any Google property visible to the connected account to a website (cross-client data exposure in agencies). | Medium | **Fixed**: Search Console properties must match the website's domain; only the person who connected the Google account (or an admin) can choose a property. |
| 3 | An admin could remove an owner (only the *last* owner was protected). | Low–Medium | **Fixed**: delete trigger; only owners remove owners. DB-tested. |
| — | Org admins could insert arbitrary users into their organization (found during this phase, before the review). | Medium | **Fixed**: client inserts on `organization_members` revoked; membership only via invitation acceptance; member limit trigger. |
| 4 | Issue status could be set to "fixed" via the API. | Low | **False positive**: already blocked by the `guard_issue_status` trigger (migration 0006). |
| 5 | Internal error text shown to users (crawl errors, configuration variable names). | Low | **Fixed** for crawl errors (generic message; details in `system_events`) and configuration messages. Provider error text from DataForSEO is still passed to users; acceptable but noted. |
| 6 | Auth email link origin could come from the request header if `NEXT_PUBLIC_SITE_URL` is unset. | Low | Mitigated: the variable always has a value and Supabase allowlists redirects; **set it in production**. |
| 7 | AI action lacked a Demo Project guard; Google property and sync actions had no rate limit. | Low | **Fixed**. |
| — | URL fields accepted any scheme via the API (React already blocks `javascript:` links). | Hardening | **Fixed**: CHECK constraints allow only `http(s)://` or `/paths`. |

Confirmed safe: all server actions and routes authorize before any service-role write; no filter injection; safe
redirects; no `dangerouslySetInnerHTML`; every user URL goes through `safeFetch`; secrets are server-only; cron secrets
are compared in constant time; OAuth state is hashed, single-use, PKCE.

## Go-live checklist

1. Set all production environment variables (see README), including `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET` and
   `TOKEN_ENCRYPTION_KEY`.
2. Run `npm run db:migrate` and `npm run db:verify` against the production database.
3. Supabase Auth: enable "Confirm email"; set Site URL and redirect URLs to the production domain.
4. Configure the scheduler for `/api/cron/crawl`, `/api/cron/ranks` and `/api/cron/google-sync`.
5. Add a platform superadmin (`platform_admins`).
6. Optional providers: Google OAuth (move the consent screen to production), DataForSEO, Anthropic, PageSpeed.
7. Payments: create Stripe products and prices, set the Stripe variables and webhook
   (`/api/billing/webhook`), then — only with approval — `BILLING_PROVIDER=stripe` and `BILLING_LIVE_APPROVED=true`.
8. Publish privacy policy and terms; add external error monitoring.
