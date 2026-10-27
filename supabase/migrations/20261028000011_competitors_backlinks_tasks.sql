-- =============================================================================
-- Phase 6 — Competitors, backlinks and SEO task workflow
--   * competitor_rankings: competitor positions read from the same SERP as our
--     own daily rank check (no extra provider call, never estimated)
--   * domain_keyword_snapshots: cached provider "ranked keywords" per domain,
--     used for overlap / gap analysis
--   * competitor_snapshots: homepage technical snapshots and page comparisons
--   * backlink_syncs + backlinks.is_new/is_lost/link_type, aggregation functions
--   * seo_tasks: one open task per issue, website-scoped task stats
-- All provider and crawl data is server-written only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Competitors
-- -----------------------------------------------------------------------------
alter table public.competitors add constraint competitors_id_org_key unique (id, organization_id);

create table public.competitor_rankings (
  organization_id uuid not null,
  competitor_id   uuid not null,
  keyword_id      uuid not null,
  checked_on      date not null,
  -- NULL = not found within the checked depth
  position        smallint check (position between 1 and 200),
  url             text check (char_length(url) <= 2048),
  source          text not null,
  primary key (competitor_id, keyword_id, checked_on),
  foreign key (competitor_id, organization_id) references public.competitors (id, organization_id) on delete cascade,
  foreign key (keyword_id, organization_id) references public.keywords (id, organization_id) on delete cascade
);

create index competitor_rankings_keyword_idx on public.competitor_rankings (keyword_id, checked_on desc);

create table public.domain_keyword_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  -- NULL competitor_id = the website's own domain
  competitor_id   uuid,
  domain          text not null check (domain ~ '^[a-z0-9.-]{3,253}$'),
  country_code    char(2) not null,
  language_code   text not null,
  provider        text not null,
  item_count      integer not null default 0,
  items           jsonb not null default '[]'::jsonb,
  fetched_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id) on delete set null,
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  foreign key (competitor_id, organization_id) references public.competitors (id, organization_id) on delete cascade
);

create index domain_keyword_snapshots_site_idx on public.domain_keyword_snapshots (website_id, domain, fetched_at desc);

create table public.competitor_snapshots (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  competitor_id   uuid not null,
  kind            text not null check (kind in ('homepage', 'page_compare')),
  keyword         text check (char_length(keyword) <= 200),
  url             text check (char_length(url) <= 2048),
  own_url         text check (char_length(own_url) <= 2048),
  data            jsonb not null default '{}'::jsonb,
  created_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  foreign key (competitor_id, organization_id) references public.competitors (id, organization_id) on delete cascade
);

create index competitor_snapshots_idx on public.competitor_snapshots (competitor_id, kind, created_at desc);

-- -----------------------------------------------------------------------------
-- Backlinks
-- -----------------------------------------------------------------------------
alter table public.backlinks
  add column is_new    boolean not null default false,
  add column is_lost   boolean not null default false,
  add column link_type text check (link_type in ('anchor', 'image', 'redirect', 'canonical', 'other'));

create index backlinks_website_seen_idx on public.backlinks (website_id, first_seen_at desc);

create table public.backlink_syncs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  provider        text not null,
  status          text not null check (status in ('completed', 'failed')),
  -- provider-reported totals for the whole target (may exceed the rows we store)
  summary         jsonb not null default '{}'::jsonb,
  rows_stored     integer not null default 0,
  error           text check (char_length(error) <= 1000),
  created_by      uuid references auth.users (id) on delete set null,
  synced_at       timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create index backlink_syncs_site_idx on public.backlink_syncs (website_id, synced_at desc);

create or replace function public.backlink_referring_domains(p_site uuid, p_limit int default 100)
returns table (domain text, backlinks bigint, follow bigint, live bigint, first_seen timestamptz, authority numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  select b.source_domain,
         count(*)::bigint,
         count(*) filter (where b.rel = 'follow')::bigint,
         count(*) filter (where not b.is_lost)::bigint,
         min(b.first_seen_at),
         max(b.domain_authority)
  from public.backlinks b
  where b.website_id = p_site
  group by b.source_domain
  order by 4 desc, 2 desc, 1
  limit least(greatest(p_limit, 1), 1000);
$$;

create or replace function public.backlink_anchors(p_site uuid, p_limit int default 100)
returns table (anchor text, backlinks bigint, domains bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(nullif(btrim(b.anchor_text), ''), '(no anchor text)'),
         count(*)::bigint,
         count(distinct b.source_domain)::bigint
  from public.backlinks b
  where b.website_id = p_site and not b.is_lost
  group by 1
  order by 2 desc, 1
  limit least(greatest(p_limit, 1), 1000);
$$;

-- -----------------------------------------------------------------------------
-- Tasks
-- -----------------------------------------------------------------------------
-- an issue can have at most one open task
create unique index seo_tasks_open_issue_idx on public.seo_tasks (issue_id)
  where issue_id is not null and status in ('todo', 'in_progress');

-- the task's issue must belong to the same website
create or replace function private.seo_task_issue_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.issue_id is not null and not exists (
    select 1 from public.seo_issues i where i.id = new.issue_id and i.website_id = new.website_id
  ) then
    raise exception 'Issue does not belong to this website' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger seo_tasks_issue_check before insert or update of issue_id, website_id on public.seo_tasks
  for each row execute function private.seo_task_issue_check();

create or replace function public.task_stats(p_org uuid, p_site uuid default null)
returns table (todo bigint, in_progress bigint, completed bigint, ignored bigint, overdue bigint, completed_30d bigint, due_7d bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) filter (where status = 'todo'),
         count(*) filter (where status = 'in_progress'),
         count(*) filter (where status = 'completed'),
         count(*) filter (where status = 'ignored'),
         count(*) filter (where status in ('todo', 'in_progress') and due_date < current_date),
         count(*) filter (where status = 'completed' and completed_at >= now() - interval '30 days'),
         count(*) filter (where status in ('todo', 'in_progress') and due_date between current_date and current_date + 7)
  from public.seo_tasks
  where organization_id = p_org and (p_site is null or website_id = p_site);
$$;

-- -----------------------------------------------------------------------------
-- RLS and grants
-- -----------------------------------------------------------------------------
alter table public.competitor_rankings      enable row level security;
alter table public.domain_keyword_snapshots enable row level security;
alter table public.competitor_snapshots     enable row level security;
alter table public.backlink_syncs           enable row level security;

create policy competitor_rankings_select on public.competitor_rankings for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy domain_keyword_snapshots_select on public.domain_keyword_snapshots for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy competitor_snapshots_select on public.competitor_snapshots for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy competitor_snapshots_delete on public.competitor_snapshots for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));
create policy backlink_syncs_select on public.backlink_syncs for select to authenticated
  using ((select private.is_org_member(organization_id)));

grant select on public.competitor_rankings, public.domain_keyword_snapshots, public.backlink_syncs to authenticated;
grant select, delete on public.competitor_snapshots to authenticated;
grant all on public.competitor_rankings, public.domain_keyword_snapshots, public.competitor_snapshots, public.backlink_syncs to service_role;

-- competitors: clients may only set name/notes when editing (domain changes = delete + add)
revoke update on public.competitors from authenticated;
grant update (name, notes) on public.competitors to authenticated;

-- tasks: clients cannot set completed_at or created_by on update, or reassign the website
revoke update on public.seo_tasks from authenticated;
grant update (title, notes, priority, status, assigned_to, due_date, page_url) on public.seo_tasks to authenticated;

revoke all on function public.backlink_referring_domains(uuid, int) from public, anon;
revoke all on function public.backlink_anchors(uuid, int) from public, anon;
revoke all on function public.task_stats(uuid, uuid) from public, anon;
grant execute on function public.backlink_referring_domains(uuid, int) to authenticated, service_role;
grant execute on function public.backlink_anchors(uuid, int) to authenticated, service_role;
grant execute on function public.task_stats(uuid, uuid) to authenticated, service_role;
