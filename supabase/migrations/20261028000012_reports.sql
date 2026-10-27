-- =============================================================================
-- Phase 7 — Reports
--   * reports.type gains 'search_performance'
--   * reports carry the snapshot format version and whether they were built
--     from Demo Data, so a demo report can never be shown as a live one
-- Reports remain server-written (snapshot frozen at generation time).
-- =============================================================================

alter table public.reports drop constraint reports_type_check;
alter table public.reports add constraint reports_type_check
  check (type in ('overview', 'site_audit', 'traffic', 'keyword_ranking', 'search_performance', 'monthly'));

alter table public.reports
  add column snapshot_version smallint not null default 1,
  add column is_demo boolean not null default false,
  add column compare_mode text not null default 'none' check (compare_mode in ('previous', 'year', 'none'));

-- the website decides whether a report is demo data, not the caller
create or replace function private.report_demo_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select w.is_demo into new.is_demo from public.websites w where w.id = new.website_id;
  return new;
end;
$$;

create trigger reports_demo_flag before insert or update of website_id on public.reports
  for each row execute function private.report_demo_flag();

create index reports_org_idx on public.reports (organization_id, created_at desc);
