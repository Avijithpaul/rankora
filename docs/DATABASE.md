# Rankora — Database

PostgreSQL on Supabase. Migrations live in `supabase/migrations/` and are applied in filename order.

| File | Contents |
|---|---|
| `…0001_core_tenancy.sql` | profiles, plans, organizations, organization_members, platform_admins, subscriptions, usage_records, audit_logs, notifications, system_events, rate limiting, `create_organization()` RPC |
| `…0002_websites_audits.sql` | websites, website_settings, crawl_jobs, crawl_pages, crawl_links, seo_audits, seo_checks, seo_issues, seo_issue_pages |
| `…0003_keywords_integrations.sql` | keywords, keyword_groups, keyword_group_members, keyword_rankings, keyword_research_queries, oauth_connections, oauth_states, integrations, analytics_daily, analytics_pages, search_console_daily/queries/pages |
| `…0004_workspace_modules.sql` | competitors, backlinks, content_analyses, seo_tasks, reports, **all grants** |
| `…0005_demo_project.sql` | `create_demo_project(jsonb)` RPC; websites cannot be added to a demo organization |
| `…0006_crawler_state.sql` | crawl job phases/state/heartbeat, crawl_pages as resumable frontier (`fetch_state`, attempts, sitemap/link discovery flags), external link errors, issue-status guard trigger, `crawl_compute_inbound()` |
| `…0007_keywords_tracking.sql` | keyword current/previous/best position + ranking URL maintained by trigger from `keyword_rankings`; rank-check claim column; volume trend; **column grants** so clients cannot write metrics or positions; demo keywords read-only |
| `…0008_oauth_profiles.sql` | profile name/avatar from Google & GitHub sign-in metadata |
| `…0009_google_integrations.sql` | Google connection status/account id (one active per org + account), integration sync state/claims, date indexes, SQL aggregations `gsc_breakdown` / `ga_breakdown` / `rank_distribution` (security invoker), `keywords.previous_checked_on` |

## Entity relationships

```
auth.users 1─1 profiles
auth.users *─* organizations           via organization_members(role)
organizations 1─1 subscriptions ─* plans
organizations 1─* websites 1─1 website_settings
websites 1─* crawl_jobs 1─* crawl_pages 1─* crawl_links
crawl_jobs 1─1 seo_audits 1─* seo_checks
websites 1─* seo_issues 1─* seo_issue_pages ;  seo_issues 1─* seo_tasks
websites 1─* keywords *─* keyword_groups (keyword_group_members) ; keywords 1─* keyword_rankings
organizations 1─* oauth_connections 1─* integrations *─1 websites
websites 1─* analytics_daily / analytics_pages / search_console_{daily,queries,pages}
websites 1─* competitors / backlinks / content_analyses / reports
```

## Conventions

* UUID primary keys (`gen_random_uuid()`); natural composite keys for daily metric tables,
  for example `search_console_queries (website_id, date, query)`.
* `organization_id` on every tenant row; composite FKs to `websites(id, organization_id)`.
* `timestamptz` everywhere; `updated_at` maintained by trigger.
* `CHECK` constraints mirror application validation (slug format, country codes, score ranges, enum-like values).
* Provider metrics (`search_volume`, `cpc`, `difficulty`) are **NULL until fetched**, never 0 by default.
* A `source` column on synced metrics (`gsc` / `ga4` / `demo`) lets the UI label data truthfully.
* Indexes on every FK used in RLS or joins, plus partial indexes (crawl queue, unread notifications, tracked keywords).

## Security model

* RLS is enabled on **every** public table.
* Helper functions sit in schema `private` (not exposed by the Data API), are `SECURITY DEFINER` with
  `search_path = ''`, and always evaluate against `auth.uid()`.
* Policies wrap helper calls in `(select …)` so they run once per statement, not once per row.
* **Grants** restrict operations and columns on top of RLS:
  * `anon` can read only `plans`.
  * Crawl, audit, analytics, ranking and backlink tables are **read-only** for clients; the server writes them with the service role.
  * `oauth_connections` token columns are not selectable by `authenticated` (column-level grant).
  * `websites.is_demo`, `organizations.plan_id` and similar columns are not client-updatable.
  * On `seo_issues`, clients may update `status` only.
* Triggers: last-owner protection, owner-grant guard, task assignee must be an org member,
  automatic profile and website-settings creation.
* `rate_limit_hit(bucket, limit, window)` is a fixed-window limiter keyed to `auth.uid()`.
* `create_demo_project(payload)` creates one demo org per user. It forces `is_demo = true` and `source = 'demo'`, ignores any ids in the payload, writes only into the new demo org, and caps payload sizes.

## Testing the schema

`npm run test:db` loads all migrations into PGlite (Postgres 17 compiled to WASM) with a stub of Supabase's
`auth` schema and roles, then checks tenant isolation, role permissions, grants, triggers and RPCs.

## Generated types

`npm run db:types` regenerates `src/lib/supabase/database.types.ts` from the migrations.
Against a live project you can instead run `supabase gen types typescript --project-id <id>`.
