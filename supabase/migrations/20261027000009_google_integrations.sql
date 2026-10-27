-- =============================================================================
-- Rankora — 0009 Google integrations (Search Console + GA4)
-- * one OAuth connection per organization + Google account (tokens encrypted,
--   never readable by clients — see column grants in 0004)
-- * sync bookkeeping on integrations (status, sync_state, last error)
-- * indexes for date-range reads of synced metrics
-- =============================================================================

alter table public.oauth_connections
  add column provider_account_id text,
  add column status text not null default 'active' check (status in ('active', 'expired', 'revoked'));

create unique index oauth_connections_account_idx
  on public.oauth_connections (organization_id, provider, provider_account_email)
  where revoked_at is null;

alter table public.integrations
  add column sync_state jsonb not null default '{}'::jsonb,
  add column last_sync_started_at timestamptz,
  add column sync_claimed_at timestamptz;

-- Clients can read the new non-secret columns
grant select (provider_account_id, status) on public.oauth_connections to authenticated;

-- Range reads: website + date (dimension-specific rows share the same PK prefix)
create index if not exists analytics_daily_site_date_idx on public.analytics_daily (website_id, date);
create index if not exists analytics_pages_site_date_idx on public.analytics_pages (website_id, date);
create index if not exists gsc_daily_site_date_idx on public.search_console_daily (website_id, date);
create index if not exists gsc_queries_site_date_idx on public.search_console_queries (website_id, date);
create index if not exists gsc_pages_site_date_idx on public.search_console_pages (website_id, date);

-- Expired OAuth states are useless; let the server purge them cheaply.
create index if not exists oauth_states_expires_idx on public.oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- Aggregations for analytics views. SECURITY INVOKER: RLS applies, so a user
-- only ever aggregates rows of organizations they belong to. Aggregating in SQL
-- also avoids the Data API's per-request row cap.
-- ---------------------------------------------------------------------------
create or replace function public.gsc_breakdown(p_site uuid, p_dim text, p_from date, p_to date, p_limit int default 100)
returns table (key text, clicks bigint, impressions bigint, ctr numeric, avg_position numeric, source text)
language sql
stable
security invoker
set search_path = ''
as $$
  with src as (
    select q.query as k, q.clicks, q.impressions, q.position, q.source from public.search_console_queries q
      where p_dim = 'query' and q.website_id = p_site and q.date between p_from and p_to
    union all
    select p.page, p.clicks, p.impressions, p.position, p.source from public.search_console_pages p
      where p_dim = 'page' and p.website_id = p_site and p.date between p_from and p_to
    union all
    select d.country, d.clicks, d.impressions, d.position, d.source from public.search_console_daily d
      where p_dim = 'country' and d.website_id = p_site and d.device = 'all' and d.country <> 'all' and d.date between p_from and p_to
    union all
    select d.device, d.clicks, d.impressions, d.position, d.source from public.search_console_daily d
      where p_dim = 'device' and d.website_id = p_site and d.country = 'all' and d.device <> 'all' and d.date between p_from and p_to
  )
  select k,
         sum(clicks)::bigint,
         sum(impressions)::bigint,
         case when sum(impressions) > 0 then round(sum(clicks)::numeric / sum(impressions), 6) end,
         case when sum(impressions) > 0 then round(sum(position * impressions) / sum(impressions), 2) end,
         min(source)
  from src
  group by k
  order by 2 desc, 3 desc, 1
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.ga_breakdown(p_site uuid, p_dim text, p_from date, p_to date, p_limit int default 100)
returns table (key text, users bigint, new_users bigint, sessions bigint, engaged_sessions bigint, page_views bigint, source text)
language sql
stable
security invoker
set search_path = ''
as $$
  with src as (
    select a.channel as k, a.users, a.new_users, a.sessions, a.engaged_sessions, a.page_views, a.source from public.analytics_daily a
      where p_dim = 'channel' and a.website_id = p_site and a.channel <> 'all' and a.device = 'all' and a.country = 'all' and a.date between p_from and p_to
    union all
    select a.device, a.users, a.new_users, a.sessions, a.engaged_sessions, a.page_views, a.source from public.analytics_daily a
      where p_dim = 'device' and a.website_id = p_site and a.device <> 'all' and a.channel = 'all' and a.country = 'all' and a.date between p_from and p_to
    union all
    select a.country, a.users, a.new_users, a.sessions, a.engaged_sessions, a.page_views, a.source from public.analytics_daily a
      where p_dim = 'country' and a.website_id = p_site and a.country <> 'all' and a.channel = 'all' and a.device = 'all' and a.date between p_from and p_to
    union all
    select p.page_path, p.users, 0, p.sessions, p.engaged_sessions, p.page_views, p.source from public.analytics_pages p
      where p_dim = 'page' and p.website_id = p_site and not p.is_landing and p.date between p_from and p_to
    union all
    select p.page_path, p.users, 0, p.sessions, p.engaged_sessions, p.page_views, p.source from public.analytics_pages p
      where p_dim = 'landing' and p.website_id = p_site and p.is_landing and p.date between p_from and p_to
  )
  select k, sum(users)::bigint, sum(new_users)::bigint, sum(sessions)::bigint, sum(engaged_sessions)::bigint, sum(page_views)::bigint, min(source)
  from src
  group by k
  order by case when p_dim = 'page' then sum(page_views) else sum(sessions) end desc, 1
  limit least(greatest(p_limit, 1), 1000);
$$;

revoke all on function public.gsc_breakdown(uuid, text, date, date, int) from public, anon;
revoke all on function public.ga_breakdown(uuid, text, date, date, int) from public, anon;
grant execute on function public.gsc_breakdown(uuid, text, date, date, int) to authenticated, service_role;
grant execute on function public.ga_breakdown(uuid, text, date, date, int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Rank tracking: know whether a previous snapshot exists (to tell "new" from
-- "first check"), and aggregate the daily distribution in SQL (no row caps).
-- ---------------------------------------------------------------------------
alter table public.keywords add column previous_checked_on date;

create or replace function private.refresh_keyword_position(p_keyword uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.keywords k
  set current_position    = latest.position,
      current_url         = latest.ranking_url,
      last_checked_on     = latest.checked_on,
      rank_source         = latest.source,
      previous_position   = prev.position,
      previous_checked_on = prev.checked_on,
      best_position       = best.position
  from
    (select position, ranking_url, checked_on, source from public.keyword_rankings
      where keyword_id = p_keyword order by checked_on desc limit 1) latest
    left join lateral (
      select position, checked_on from public.keyword_rankings
      where keyword_id = p_keyword and checked_on < latest.checked_on
      order by checked_on desc limit 1) prev on true
    left join lateral (
      select min(position) as position from public.keyword_rankings
      where keyword_id = p_keyword and position is not null) best on true
  where k.id = p_keyword;
$$;

select private.refresh_keyword_position(id) from public.keywords;

create or replace function public.rank_distribution(p_site uuid, p_from date)
returns table (date date, top3 int, top10 int, top20 int, top100 int, not_ranking int, source text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.checked_on,
         count(*) filter (where r.position between 1 and 3)::int,
         count(*) filter (where r.position between 4 and 10)::int,
         count(*) filter (where r.position between 11 and 20)::int,
         count(*) filter (where r.position between 21 and 100)::int,
         count(*) filter (where r.position is null)::int,
         min(r.source)
  from public.keyword_rankings r
  join public.keywords k on k.id = r.keyword_id
  where k.website_id = p_site and k.is_tracked and r.checked_on >= p_from
  group by r.checked_on
  order by r.checked_on;
$$;

revoke all on function public.rank_distribution(uuid, date) from public, anon;
grant execute on function public.rank_distribution(uuid, date) to authenticated, service_role;
