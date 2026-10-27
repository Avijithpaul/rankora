# Rankora — Security

## Authentication

* Supabase Auth, email + password (min 10 characters, letter + number), optional email confirmation.
* Session cookies are managed by `@supabase/ssr`; `src/proxy.ts` refreshes them on each request.
* Identity is established with `auth.getClaims()` (JWT signature verified), never `getSession()` alone.
* Login errors and password-reset requests never reveal whether an email exists.
* Password reset: `/forgot-password` sends a PKCE recovery link → `/auth/callback` exchanges the code for a short-lived session →
  `/reset-password` sets the new password (requires that session). Signed-in users change their password under Account settings.
* Post-login redirects go through `safeNextPath()` (relative paths only; blocks `//evil.com`, `/\evil.com`, CRLF).

## Authorization (defence in depth)

1. **Proxy**: optimistic redirect of anonymous users away from `/app`, `/onboarding`, `/admin`.
2. **DAL** (`src/lib/auth/dal.ts`): every page and action resolves the organization or website through
   the user's memberships and checks the minimum role.
3. **Postgres RLS** on every table, plus column-level **grants**, plus composite FKs that bind child rows
   to their website's organization. Verified by `tests/db/rls.test.ts`.
4. Service-role access (`createAdminClient`) only in server code, only after step 2.

## Secrets

* Only `NEXT_PUBLIC_SUPABASE_URL`, the publishable key and the site URL reach the browser.
* `server-only` imports guard server modules from being bundled client-side.
* OAuth tokens: AES-256-GCM with a random 96-bit IV per value, authenticated (tamper-evident),
  key from `TOKEN_ENCRYPTION_KEY`. OAuth `state` is stored only as a SHA-256 hash, single-use, 10-minute TTL.
* `.env*` files are git-ignored (except `.env.example`).

## SSRF protection (crawler and any user-supplied URL)

`src/lib/security/url-safety.ts` + `safe-fetch.ts`:

* Protocols: `http`, `https` only. No embedded credentials. Ports: default, 80, 443, 8080, 8443.
* Blocks `localhost`, single-label hosts, `.local`, `.internal`, `.lan`, cloud metadata hostnames.
* IP literals in any notation (decimal, hex, IPv6, IPv4-mapped IPv6) are parsed and must be public unicast.
* Every DNS answer must be public (private, loopback, link-local incl. `169.254.169.254`, CGNAT, ULA,
  multicast and reserved ranges are all rejected).
* **DNS rebinding**: the HTTP agent's own `lookup` re-validates the address actually dialled.
* Redirects are followed manually (max 5) and every hop is re-validated.
* Timeouts (connect 10 s, headers 15 s, total 20 s) and a 3 MB body cap.
* Covered by `tests/unit/url-safety.test.ts`.

## Crawler-specific protections (Phase 2)

* The crawler only uses `createSafeFetcher()` → `safeFetch` for every request (pages, robots.txt, sitemaps,
  redirect targets, external link checks). Private/loopback/link-local/metadata targets are refused, even
  when a crawled page links to them. Tested against a real local HTTP server (`tests/unit/crawl-engine.test.ts`).
* Same-site scope: only the website's host (± `www.`) is crawled; subdomains and other hosts are never followed.
* Limits: page cap (website setting, capped by plan), depth cap, 3 MB body cap, 15 s timeout, 5 redirects,
  max 3 attempts per URL, max 100 external checks, 500 stored links per page.
* Politeness: identifies as `RankoraBot/1.0`, respects robots.txt (incl. Crawl-delay, max 10 s) by default,
  configurable delay, concurrency 1 when delay ≥ 1 s.
* Authorization: starting requires role ≥ member on a non-demo, active website; tick/status endpoints first
  read the job **as the user** (RLS) — another tenant's job is a 404 — and only then use the service role.
  The cron endpoint requires `Bearer CRON_SECRET` (constant-time compare).
* Clients cannot write crawl tables, call `crawl_compute_inbound`, or set an issue to `fixed`
  (trigger `guard_issue_status`); members can only ignore/reopen issues.
* Rate limit: 10 audit starts per user per hour.

## Keyword & ranking data integrity (Phase 3)

* Column-level grants: clients may insert keyword definitions and update only `target_url`, `is_tracked`, `notes`.
  Provider metrics, positions and rank snapshots are server-written only, so a user cannot fabricate “provider” data.
* Saving research results reads metrics from the server-stored provider response, never from form input.
* Demo keywords are read-only for clients; demo data is never returned for real websites.
* Group membership uses composite FKs, so keywords and groups from different organizations cannot be linked.
* Rank-check and export endpoints resolve the website as the user (RLS) before any service-role work; cron requires `CRON_SECRET`.
* CSV export neutralises formula injection (`=`, `+`, `-`, `@` prefixes).

## Google OAuth (Phase 4)

* Read-only scopes only (`webmasters.readonly`, `analytics.readonly`, `openid email`).
* `state`: 32 random bytes, stored as SHA-256 only, 10-minute expiry, **single use** (atomic claim), bound to the
  signed-in user, organization and website; a different user, reused, expired or unknown state is rejected.
* **PKCE S256**; the verifier is stored encrypted and never leaves the server.
* Tokens: AES-256-GCM at rest, never selectable by clients (column grants), never sent to the browser; refreshed
  server-side; revoked/invalid refresh tokens mark the connection expired and wipe the access token.
* The callback re-checks that the user is still member+ of the website; property selection is re-validated against
  Google's live property list (a user cannot attach a property their Google account cannot access).
* Fixed redirect URI from `NEXT_PUBLIC_SITE_URL`; post-connect redirects use a stored, validated relative path.
* Disconnect revokes at Google and deletes ciphertext; audit log entries for connect / property change / disconnect / revoke.
* Synced metrics are server-written only; clients cannot insert or update them. Aggregation functions are
  SECURITY INVOKER so RLS still scopes every query to the user's organizations.

## Content Optimizer & AI (Phase 5)

* URL mode only fetches pages on the website's own domain (also after redirects) through `safeFetch`, so private, loopback and
  metadata addresses stay blocked. Pasted drafts are parsed, never executed or rendered as HTML.
* `content_analyses` is written only by the server after `requireWebsite` (member+, non-demo). Members read and delete their
  organization's history (RLS); clients cannot insert or update analyses or AI output.
* AI: the key lives only in `ANTHROPIC_API_KEY` (server). Page content is fenced as untrusted input to resist prompt injection.
  Output is schema-validated and sanitised (internal-link targets restricted to crawled URLs) and rendered as plain text.
  Suggestions are labelled and never published.
* Rate limits: 60 analyses and 30 AI requests per user per hour.

## Competitors, backlinks & tasks (Phase 6)

* Competitor domains are normalised and validated (no IPs, single labels or own domain); every competitor fetch goes through
  `safeFetch` and respects robots.txt for RankoraBot. Page comparisons only fetch URLs on the respective domain.
* Competitor rankings, keyword snapshots, snapshots, backlinks and sync history are server-written only (grants + RLS).
  A competitor's domain cannot be changed by clients (column grant), so stored data can never be re-labelled to another domain.
* Backlink and competitor-keyword data come only from a configured provider. Without one, the UI shows “Provider Not
  Connected”. Tests use clearly labelled test doubles, never stored as production data.
* Tasks: member+ write, viewers read-only; `completed_at`, `created_by` and `website_id` are not client-writable; the
  assignee must belong to the organization and the source issue to the same website (triggers); one open task per issue.
* Rate limits per user per hour: 20 competitor keyword refreshes, 30 homepage snapshots, 30 page comparisons, 5 backlink
  syncs; plus monthly keyword-lookup and backlink-sync quotas.

## Abuse and cost controls

* `rate_limit_hit()` (DB-backed, per user) for expensive operations: crawls, keyword lookups, PageSpeed calls.
* Plan limits (websites, pages per audit, tracked keywords) enforced in server actions, not just the UI.
* One active crawl per website (partial unique index).
* The crawler identifies itself (`RankoraBot`), respects robots.txt by default and applies a per-site delay.

## HTTP hardening

`next.config.ts` sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
`Permissions-Policy` and HSTS, and removes `X-Powered-By`. A strict Content Security Policy is on the roadmap.

## Admin access

* Platform admins are a separate table (`platform_admins`), not a tenant role. `/admin` returns 404 for others.
* The admin console shows aggregate counts and configuration status only, never customer SEO content.
* `superadmin` access to customer data is planned to go through audited endpoints that write `audit_logs`.

## Auditing

Sensitive mutations (organization and website create/update/delete, crawl settings) are written to
`audit_logs` through the service role. Organization admins can read their own organization's log.

## Known gaps (tracked in ROADMAP)

* No CSP yet; no MFA; no team invitations (so no invite-token flow yet).
* `audit_logs` writes need the service key configured; without it they are skipped (logged to the console).
