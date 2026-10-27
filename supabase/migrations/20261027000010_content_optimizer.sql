-- =============================================================================
-- Phase 5 — Page Explorer and Content Optimizer
--   * content_analyses: scoring version, per-website history index, URL check
--   * page_explorer(): crawl pages joined with GSC, GA4, keywords and issues
--     (SECURITY INVOKER, so RLS still scopes every row to the caller)
-- =============================================================================

alter table public.content_analyses
  add column scoring_version text,
  add column word_count integer check (word_count >= 0),
  add column ai_generated_at timestamptz,
  add constraint content_analyses_url_required check (source_type <> 'url' or source_url is not null);

create index content_analyses_site_idx on public.content_analyses (website_id, created_at desc);

-- GA4 reports pagePath without host or query string; the crawler stores full URLs.
create or replace function public.url_path(p_url text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(split_part(split_part(regexp_replace(p_url, '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/?#]*', ''), '#', 1), '?', 1), ''), '/');
$$;

create or replace function public.page_explorer(
  p_site      uuid,
  p_job       uuid,
  p_from      date,
  p_to        date,
  p_search    text default null,
  p_status    text default 'all',
  p_indexable text default 'all',
  p_sort      text default 'clicks',
  p_limit     int  default 50,
  p_offset    int  default 0
)
returns table (
  page_id             uuid,
  url                 text,
  title               text,
  fetch_state         text,
  status_code         int,
  is_indexable        boolean,
  indexability_reason text,
  word_count          int,
  inbound_links       int,
  response_time_ms    int,
  depth               int,
  clicks              bigint,
  impressions         bigint,
  ctr                 numeric,
  avg_position        numeric,
  gsc_source          text,
  users               bigint,
  sessions            bigint,
  page_views          bigint,
  ga_source           text,
  open_issues         bigint,
  keywords            bigint,
  total_count         bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with pages as (
    select cp.*
    from public.crawl_pages cp
    where cp.crawl_job_id = p_job
      and cp.website_id = p_site
      and cp.fetch_state <> 'pending'
      and (p_search is null or p_search = '' or cp.normalized_url ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
      and case p_status
            when '2xx' then cp.status_code between 200 and 299
            when '3xx' then cp.status_code between 300 and 399
            when '4xx' then cp.status_code between 400 and 499
            when '5xx' then cp.status_code >= 500
            when 'failed' then cp.fetch_state = 'failed'
            when 'skipped' then cp.fetch_state = 'skipped'
            else true
          end
      and case p_indexable when 'yes' then cp.is_indexable is true when 'no' then cp.is_indexable is false else true end
  ),
  gsc as (
    select s.page,
           sum(s.clicks)::bigint as clicks,
           sum(s.impressions)::bigint as impressions,
           case when sum(s.impressions) > 0 then round(sum(s.position * s.impressions) / sum(s.impressions), 2) end as avg_position,
           min(s.source) as source
    from public.search_console_pages s
    where s.website_id = p_site and s.date between p_from and p_to
    group by s.page
  ),
  ga as (
    select a.page_path,
           sum(a.users)::bigint as users,
           sum(a.sessions)::bigint as sessions,
           sum(a.page_views)::bigint as page_views,
           min(a.source) as source
    from public.analytics_pages a
    where a.website_id = p_site and a.is_landing = false and a.date between p_from and p_to
    group by a.page_path
  ),
  issues as (
    select ip.url, count(*)::bigint as n
    from public.seo_issue_pages ip
    join public.seo_issues i on i.id = ip.issue_id
    where i.website_id = p_site and i.status = 'open'
    group by ip.url
  ),
  kws as (
    select u as url, count(distinct k.id)::bigint as n
    from public.keywords k
    cross join lateral (values (k.target_url), (k.current_url)) as v(u)
    where k.website_id = p_site and u is not null
    group by u
  ),
  joined as (
    select p.id, p.normalized_url, p.title, p.fetch_state, p.status_code::int, p.is_indexable, p.indexability_reason,
           p.word_count, p.inbound_links_count, p.response_time_ms, p.depth::int,
           g.clicks, g.impressions,
           case when g.impressions > 0 then round(g.clicks::numeric / g.impressions, 6) end as ctr,
           g.avg_position, g.source as gsc_source,
           a.users, a.sessions, a.page_views, a.source as ga_source,
           coalesce(iss.n, 0) as open_issues, coalesce(kw.n, 0) as keywords
    from pages p
    left join gsc g on g.page = p.normalized_url
    left join ga a on a.page_path = public.url_path(p.normalized_url)
    left join issues iss on iss.url = p.normalized_url
    left join kws kw on kw.url = p.normalized_url
  )
  select j.*, count(*) over ()::bigint
  from joined j
  order by
    case p_sort when 'clicks' then j.clicks when 'impressions' then j.impressions when 'views' then j.page_views
                when 'issues' then j.open_issues when 'inlinks' then j.inbound_links_count::bigint end desc nulls last,
    case when p_sort = 'position' then j.avg_position end asc nulls last,
    case when p_sort = 'words' then j.word_count end asc nulls last,
    j.depth, j.normalized_url
  limit least(greatest(p_limit, 1), 200)
  offset greatest(p_offset, 0);
$$;

revoke all on function public.url_path(text) from public;
revoke all on function public.page_explorer(uuid, uuid, date, date, text, text, text, text, int, int) from public, anon;
grant execute on function public.url_path(text) to authenticated, service_role;
grant execute on function public.page_explorer(uuid, uuid, date, date, text, text, text, text, int, int) to authenticated, service_role;
