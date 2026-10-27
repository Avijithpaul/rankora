# Rankora — Academic Demo Guide

How to present Rankora as a Web Development project. Each row maps a marking criterion to something
you can show live and the code behind it.

| Criterion | What to show | Where in the code |
|---|---|---|
| Authentication | Register → (confirm email) → sign in → sign out; protected routes redirect to login | `src/app/(auth)/`, `src/proxy.ts`, `src/lib/auth/dal.ts` |
| CRUD | Create organization, add/edit/delete website, edit crawl settings | `src/lib/actions/workspace.ts`, `src/app/app/[org]/…` |
| Database relationships | ER overview; composite FKs; generated types | `docs/DATABASE.md`, `supabase/migrations/` |
| Security | RLS tenant isolation test run; SSRF test run; encrypted tokens | `tests/db/rls.test.ts`, `tests/unit/url-safety.test.ts`, `docs/SECURITY.md` |
| Forms & validation | Submit invalid URL `http://localhost` → inline error; weak password → error | `src/lib/validation/schemas.ts`, `src/components/ui/form.tsx` |
| SEO crawling & server-side processing | Run a Site Audit live: progress bar, then score, issues, affected pages, page details, Technical SEO | `src/lib/actions/`, `src/lib/security/safe-fetch.ts` |
| API / external integrations | Provider abstraction (KeywordProvider/RankProvider), DataForSEO adapter, “Provider Not Connected” state, CSV import/export | `docs/INTEGRATIONS.md` |
| Data visualization | Score ring; trend charts (Recharts) once data exists | `src/components/ui/score-ring.tsx`, `src/components/charts/` |
| Responsive frontend | Resize to phone width: drawer navigation, stacked cards | `src/components/app/sidebar.tsx` |
| Real-world SaaS architecture | Multi-tenant orgs, roles, plans/limits, audit log, admin area | `docs/ARCHITECTURE.md` |
| Testing | `npm test` (309 tests), `npm run lint`, `npm run typecheck`, `npm run build` | `tests/` |

## Suggested 14-minute script

1. **Landing page** (1 min): positioning, honest-data principle, sample preview is labelled.
2. **Register + onboarding** (2 min): create organization (slug validation), add a website
   (try `http://localhost` first to show SSRF validation), next-steps screen.
3. **Dashboard** (2 min): explain that every empty card is empty *on purpose* — no data is invented;
   "Planned" modules are labelled with their phase.
4. **Site Audit** (3 min): click Run audit on a real site you own; watch the crawl progress; open a critical issue, its affected pages and a page detail; show the audit history and Technical SEO.
5. **Keywords** (2 min): in the Demo Project show Keyword Research (Demo Data badges), Rank Tracker distribution chart and a keyword’s ranking history; in a real site show the “Provider Not Connected” state and CSV import/export.
6. **Page Explorer + Content Optimizer** (2 min): sort Pages by clicks, open a page and show its recommendations, then click *Optimize content*. Walk through the checks (each one states what it measured), the related terms and their sources, and the internal-link opportunities. Paste a short Markdown draft to show draft mode. If `ANTHROPIC_API_KEY` is set, generate SEO titles and point out the *AI suggestion* label; otherwise show the honest *AI provider not connected* state.
7. **Competitors & Tasks** (2 min): add a competitor, open *SEO audit comparison* and take a homepage snapshot (same 15 checks on both sides); show *Content comparison* for one keyword; on Backlinks show the honest *Provider Not Connected* state. Then on an audit issue click *Create task*, move it across the board and show the progress card on the dashboard.
8. **Settings** (1 min): edit crawl settings; plan limit enforced server-side (try 5000 pages on Free).
9. **Security** (2 min): run `npm run test:db` and walk through one RLS test (Bob cannot read Alice's websites).
10. **Scoring** (2 min): open `docs/SEO-SCORING.md`, show the worked example and run `npx vitest run tests/unit/scoring.test.ts`.

## Demo data

Open the **Demo Project** (onboarding page or organization switcher). It is a separate organization with a fictional
`.example` website. A purple banner sits on every page and every metric shows a **Demo Data** badge. Use it to show charts,
top queries, ranking movement and the audit score, and say clearly that the numbers are sample data. The audit score in the
demo is still calculated by the real scoring engine from the sample rule results.
