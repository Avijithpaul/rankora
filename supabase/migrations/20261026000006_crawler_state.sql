-- =============================================================================
-- Rankora — 0006 Crawler state
-- crawl_pages doubles as the crawl frontier (fetch_state = 'pending'), so a crawl
-- can be resumed across short serverless invocations ("ticks").
-- =============================================================================

alter table public.crawl_jobs
  add column phase text not null default 'discovery'
    check (phase in ('discovery', 'crawling', 'link_check', 'pagespeed', 'analyzing', 'done')),
  add column state jsonb not null default '{}'::jsonb,
  add column audit_id uuid,
  add column heartbeat_at timestamptz;

alter table public.crawl_pages
  add column fetch_state text not null default 'fetched'
    check (fetch_state in ('pending', 'fetched', 'failed', 'skipped')),
  add column attempts smallint not null default 0,
  add column found_in_sitemap boolean not null default false,
  add column found_via_link boolean not null default false,
  add column skip_reason text;

-- frontier lookup: next pending URLs by depth
create index crawl_pages_frontier_idx on public.crawl_pages (crawl_job_id, depth, crawled_at)
  where fetch_state = 'pending';

alter table public.crawl_links add column target_error text;
create index crawl_links_external_unchecked_idx on public.crawl_links (crawl_job_id, target_url)
  where is_internal = false and target_status is null and target_error is null;

-- jobs that a worker can pick up (oldest first)
create index crawl_jobs_active_idx on public.crawl_jobs (created_at) where status in ('queued', 'running');

-- Issue status changes by members: only open <-> ignored (fixed is set by audits).
create or replace function private.guard_issue_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null and new.status is distinct from old.status then
    if new.status not in ('open', 'ignored') then
      raise exception 'Issues can only be ignored or reopened manually' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

create trigger seo_issues_guard_status before update on public.seo_issues
  for each row execute function private.guard_issue_status();

-- Inbound internal link counts per crawled page (called by the server after a crawl).
create or replace function public.crawl_compute_inbound(p_job uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.crawl_pages p
  set inbound_links_count = coalesce(x.n, 0),
      internal_links_count = coalesce(o.internal, 0),
      external_links_count = coalesce(o.external, 0)
  from public.crawl_pages p2
  left join (
    select l.target_url, count(distinct l.source_page_id)::int as n
    from public.crawl_links l
    join public.crawl_pages s on s.id = l.source_page_id
    where l.crawl_job_id = p_job and l.is_internal and l.target_url <> s.normalized_url
    group by l.target_url
  ) x on x.target_url = p2.normalized_url
  left join (
    select source_page_id,
           count(*) filter (where is_internal)::int as internal,
           count(*) filter (where not is_internal)::int as external
    from public.crawl_links where crawl_job_id = p_job group by source_page_id
  ) o on o.source_page_id = p2.id
  where p.id = p2.id and p.crawl_job_id = p_job;
$$;

revoke all on function public.crawl_compute_inbound(uuid) from public, anon, authenticated;
grant execute on function public.crawl_compute_inbound(uuid) to service_role;
