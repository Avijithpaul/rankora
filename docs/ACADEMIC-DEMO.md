# Rankora — Academic Demo Guide

A 5–10 minute presentation flow for a viva or class demo, plus a map from marking criteria to code.
The same flow is available in the app at **`/academic-demo`**, and the technical summary at **`/project`**
(see also [PROJECT-DOCUMENTATION.md](PROJECT-DOCUMENTATION.md)).

## Before you start (2 minutes)

1. Sign in and open the **Demo Project** once (onboarding → *Open Demo Project*), so your own organization and
   the demo workspace are both in the organization switcher.
2. Run a Site Audit on your own website in advance, in case the network is slow. Only crawl sites you own or that
   allow crawling (e.g. `books.toscrape.com`).
3. In the Demo Project, create a **Monthly SEO Summary** report (Reports → Monthly SEO Summary) so it is ready to
   print. It is marked **Demo Data** everywhere.
4. Open a terminal in the project folder for the security step (`npm run test:db`).

## About demo data

The Demo Project is a separate, read-only organization with a fictional `.example` website. A purple banner sits on
every page, every metric shows a **Demo Data** badge, demo reports carry a Demo Data banner, and demo CSV exports are
named `…-DEMO-DATA.csv`. Say clearly that these numbers are samples. Demo data is never shown for a real website.

## Presentation flow (≈ 9 minutes)

| # | Step | Time | Say | Show |
|---|---|---|---|---|
| 1 | **Problem statement** | 0:30 | Small teams juggle several SEO tools, pay for each, and many dashboards show estimated or invented numbers. It is hard to know what to fix first and to prove progress. | Landing page; the data-honesty note in the footer. |
| 2 | **Solution** | 0:30 | One workspace for audit, keywords, rankings, Search Console, GA4, content optimization, competitors, tasks and reports — and every number shows its source. | `/features`. The rule: data comes from a crawl, a connected provider, or is labelled Demo Data. |
| 3 | **Architecture** | 1:00 | Next.js 16 renders pages on the server and runs Server Actions; Supabase Postgres stores everything behind row-level security; external APIs sit behind provider interfaces. | Architecture diagram at `/project#architecture`. |
| 4 | **Registration / login** | 0:45 | Supabase Auth: email/password plus Google and GitHub; HTTP-only cookie sessions; identity verified with JWT signature checks. | Register → create an organization (slug validation) → sign out → sign in. |
| 5 | **Add website** | 0:30 | Several websites per organization; every URL is checked against SSRF before anything is fetched. | Onboarding → website: type `http://localhost` (rejected), then a real domain. |
| 6 | **Run SEO audit** | 1:00 | The crawler reads robots.txt and sitemaps, follows internal links within limits and evaluates 33 documented rules. | Site Audit → *Run audit*; live progress (discovery → crawling → link check → analyzing). |
| 7 | **Show real audit results** | 1:00 | The score is a weighted formula, not a black box. Each issue explains why it matters, how to fix it and which pages it affects. | Score ring and categories → a critical issue → affected page → *Create task* → SEO Tasks board. Then Page Explorer. |
| 8 | **Add keywords** | 0:45 | Keywords can be added, imported from CSV, grouped and tracked. Without a data provider the app shows *Provider Not Connected* instead of inventing volumes. | Saved Keywords: add two keywords and a target URL. Switch to the Demo Project for the Rank Tracker chart (**Demo Data**). |
| 9 | **Analytics / Search Console integration** | 1:00 | Google OAuth with PKCE and read-only scopes; tokens encrypted with AES-256-GCM; a resumable sync imports daily data labelled with its source. | Integrations page states; in the Demo Project, Search Performance and Analytics (**Demo Data**). |
| 10 | **Database relationships** | 0:45 | 43 tables, `organization_id` on every tenant row, and composite foreign keys that bind child rows to their website's organization. | Relationship table at `/academic-demo#database` or [DATABASE.md](DATABASE.md). |
| 11 | **Security** | 1:00 | Three layers: proxy, server-side role checks and Postgres RLS. Clients cannot write metrics or scores, and every fetched URL is SSRF-checked. | Run `npm run test:db`; open one test in `tests/db/rls.test.ts` (another tenant reads nothing). |
| 12 | **Future SaaS business model** | 0:45 | Free tier for one website; paid plans raise websites, pages per audit and tracked keywords; provider costs are metered per organization. Agency white-label reports are planned. | `/pricing`; plan limits enforced on the server (try 5,000 pages on Free in Site Settings). Finish by printing the Monthly SEO Summary to PDF. |

**Shorter 5-minute version:** steps 1, 2, 3 (30 s), 6–7 (2 min), 9 (30 s), 11, 12.

## Likely viva questions

* **Where do the numbers come from?** A real crawl, a connected provider (Google, DataForSEO), or the labelled Demo
  Project. Missing data is shown as missing, with the reason.
* **How do you stop one customer seeing another's data?** RLS on all 43 tables, server-side role checks, composite
  foreign keys; verified by `tests/db/*` and `npm run db:verify` against the live database.
* **Can the crawler be used to reach internal servers?** No: every DNS answer and redirect is validated; private,
  loopback and cloud-metadata addresses are refused (`tests/unit/url-safety.test.ts`).
* **How is the SEO score calculated?** See [SEO-SCORING.md](SEO-SCORING.md): weighted rules, page rules scaled by the
  share of affected pages, not-applicable rules excluded.
* **Does AI change my website?** No. AI suggestions are optional, labelled "AI suggestion" and never published.
* **Why are reports frozen?** A report stores a snapshot at generation time, so a printed report stays reproducible
  even after new data arrives.

## Marking criteria → code

| Criterion | What to show | Where in the code |
|---|---|---|
| Authentication | Register → sign in → sign out; protected routes redirect to login; Google/GitHub sign-in | `src/app/(auth)/`, `src/proxy.ts`, `src/lib/auth/dal.ts` |
| CRUD | Websites, keywords, competitors, tasks, reports (create / edit / delete) | `src/lib/actions/`, `src/app/app/[org]/…` |
| Database relationships | ER overview; composite FKs; generated types | `docs/DATABASE.md`, `supabase/migrations/` |
| Security | RLS tenant-isolation tests; SSRF tests; encrypted tokens | `tests/db/rls.test.ts`, `tests/unit/url-safety.test.ts`, `docs/SECURITY.md` |
| Forms & validation | `http://localhost` → inline error; weak password → error; invalid task date → error | `src/lib/validation/schemas.ts`, `src/lib/tasks/utils.ts` |
| SEO crawling & server-side processing | Live Site Audit: progress, score, issues, affected pages, Page Explorer | `src/lib/crawler/`, `src/lib/audit/` |
| APIs & external integrations | Provider interfaces, DataForSEO adapter, Google OAuth, report export API | `src/lib/providers/`, `src/lib/google/`, `src/app/api/` |
| Data visualization | Score ring; trend charts; ranking distribution; task progress | `src/components/charts/`, `src/components/ui/score-ring.tsx` |
| Reports | Six report types, date range + comparison, print view, CSV/JSON export | `src/lib/reports/`, `src/components/reports/` |
| Responsive frontend | Phone width: drawer navigation, stacked cards | `src/components/app/sidebar.tsx` |
| Real-world SaaS architecture | Multi-tenant organizations, roles, plans and limits, audit log, admin area | `docs/ARCHITECTURE.md` |
| Testing | `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, live checks | `tests/`, `scripts/` |
