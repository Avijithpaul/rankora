-- =============================================================================
-- Rankora — 0004 Competitors, backlinks, content, tasks, reports + grants
-- =============================================================================

create table public.competitors (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  domain          text not null check (domain ~ '^[a-z0-9.-]{3,253}$'),
  name            text check (char_length(name) <= 80),
  notes           text check (char_length(notes) <= 2000),
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  unique (website_id, domain)
);

-- Backlinks only ever come from a configured provider (provider is required).
create table public.backlinks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  website_id       uuid not null,
  source_url       text not null,
  source_domain    text not null,
  target_url       text not null,
  anchor_text      text,
  rel              text not null default 'follow' check (rel in ('follow', 'nofollow', 'ugc', 'sponsored')),
  domain_authority numeric(5, 2),
  provider         text not null,
  first_seen_at    timestamptz,
  last_seen_at     timestamptz,
  lost_at          timestamptz,
  synced_at        timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  unique (website_id, source_url, target_url)
);

create index backlinks_website_domain_idx on public.backlinks (website_id, source_domain);

create table public.content_analyses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id      uuid,
  target_keyword  text not null check (char_length(target_keyword) between 1 and 200),
  source_type     text not null check (source_type in ('url', 'draft')),
  source_url      text check (char_length(source_url) <= 2048),
  title           text,
  score           numeric(5, 2) check (score between 0 and 100),
  results         jsonb not null default '{}'::jsonb,
  -- AI suggestions are always stored separately and labelled in the UI
  ai_suggestions  jsonb,
  ai_model        text,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create index content_analyses_org_idx on public.content_analyses (organization_id, created_at desc);

create table public.seo_tasks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  issue_id        uuid,
  page_url        text check (char_length(page_url) <= 2048),
  title           text not null check (char_length(title) between 1 and 200),
  notes           text check (char_length(notes) <= 5000),
  priority        text not null default 'medium' check (priority in ('critical', 'high', 'medium', 'low')),
  status          text not null default 'todo' check (status in ('todo', 'in_progress', 'completed', 'ignored')),
  source          text not null default 'manual' check (source in ('manual', 'issue', 'recommendation')),
  assigned_to     uuid references auth.users (id) on delete set null,
  due_date        date,
  completed_at    timestamptz,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  foreign key (issue_id, organization_id) references public.seo_issues (id, organization_id) on delete set null (issue_id)
);

create index seo_tasks_website_status_idx on public.seo_tasks (website_id, status);
create index seo_tasks_assignee_idx on public.seo_tasks (assigned_to) where assigned_to is not null;
create index seo_tasks_issue_idx on public.seo_tasks (issue_id) where issue_id is not null;

create trigger seo_tasks_updated_at before update on public.seo_tasks
  for each row execute function private.set_updated_at();

create or replace function private.seo_task_completed_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'completed' and (tg_op = 'INSERT' or old.status <> 'completed') then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;

create trigger seo_tasks_completed_at before insert or update on public.seo_tasks
  for each row execute function private.seo_task_completed_at();

-- assignee must belong to the same organization
create or replace function private.seo_task_assignee_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id and m.user_id = new.assigned_to
  ) then
    raise exception 'Assignee is not a member of this organization' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger seo_tasks_assignee_check before insert or update on public.seo_tasks
  for each row execute function private.seo_task_assignee_check();

create table public.reports (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  type            text not null check (type in ('overview', 'site_audit', 'traffic', 'keyword_ranking', 'monthly')),
  title           text not null check (char_length(title) between 1 and 200),
  date_from       date not null,
  date_to         date not null,
  compare_from    date,
  compare_to      date,
  status          text not null default 'ready' check (status in ('draft', 'generating', 'ready', 'failed')),
  -- frozen data used to render the report, so it stays reproducible
  snapshot        jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  check (date_from <= date_to),
  check ((compare_from is null) = (compare_to is null)),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create index reports_website_idx on public.reports (website_id, created_at desc);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.competitors      enable row level security;
alter table public.backlinks        enable row level security;
alter table public.content_analyses enable row level security;
alter table public.seo_tasks        enable row level security;
alter table public.reports          enable row level security;

create policy competitors_select on public.competitors for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy competitors_insert on public.competitors for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')));
create policy competitors_update on public.competitors for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));
create policy competitors_delete on public.competitors for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

create policy backlinks_select on public.backlinks for select to authenticated
  using ((select private.is_org_member(organization_id)));

create policy content_select on public.content_analyses for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy content_delete on public.content_analyses for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

create policy tasks_select on public.seo_tasks for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy tasks_insert on public.seo_tasks for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')));
create policy tasks_update on public.seo_tasks for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));
create policy tasks_delete on public.seo_tasks for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

create policy reports_select on public.reports for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy reports_delete on public.reports for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

-- =============================================================================
-- Grants. RLS decides *which rows*; grants decide *which operations/columns*.
-- anon gets nothing except the public plan catalog.
-- =============================================================================
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant usage on schema private to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, public.org_role) to authenticated;
grant execute on function private.role_rank(public.org_role) to authenticated;
grant execute on function private.is_platform_admin() to authenticated;

grant select on public.plans to anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update, delete on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select on public.platform_admins, public.subscriptions, public.usage_records,
               public.audit_logs to authenticated;
grant select, update, delete on public.notifications to authenticated;

grant select, insert, update, delete on public.websites to authenticated;
grant select, update on public.website_settings to authenticated;
grant select on public.crawl_jobs, public.crawl_pages, public.crawl_links,
               public.seo_audits, public.seo_checks, public.seo_issue_pages to authenticated;
grant select on public.seo_issues to authenticated;
grant update (status) on public.seo_issues to authenticated;

grant select, insert, update, delete on public.keywords, public.keyword_groups to authenticated;
grant select, insert, delete on public.keyword_group_members to authenticated;
grant select on public.keyword_rankings, public.keyword_research_queries, public.integrations,
               public.analytics_daily, public.analytics_pages, public.search_console_daily,
               public.search_console_queries, public.search_console_pages, public.backlinks to authenticated;

-- OAuth tokens are never selectable by clients: grant only non-secret columns.
grant select (id, organization_id, connected_by, provider, provider_account_email, scopes,
              token_expires_at, revoked_at, created_at, updated_at)
  on public.oauth_connections to authenticated;

grant select, insert, update, delete on public.competitors, public.seo_tasks to authenticated;
grant select, delete on public.content_analyses, public.reports to authenticated;

-- Column-level restrictions on otherwise-editable tables
revoke update on public.websites from authenticated;
grant update (name, base_url, preferred_domain, country_code, language_code, status)
  on public.websites to authenticated;
revoke update on public.organizations from authenticated;
grant update (name) on public.organizations to authenticated;
revoke update on public.organization_members from authenticated;
grant update (role) on public.organization_members to authenticated;
revoke update on public.profiles from authenticated;
grant update (full_name, avatar_url, timezone, last_organization_id, onboarding_completed_at) on public.profiles to authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

grant execute on function public.create_organization(text, text) to authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to authenticated;

-- service_role (server-side only) keeps full access
grant usage on schema private to service_role;
grant all on all tables in schema public to service_role;
grant all on all tables in schema private to service_role;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema private to service_role;
