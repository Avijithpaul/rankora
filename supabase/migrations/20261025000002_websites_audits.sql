-- =============================================================================
-- Rankora — 0002 Websites, crawling and SEO audits
-- Child tables reference websites with a composite FK (website_id, organization_id)
-- so a row can never claim an organization different from its website's.
-- =============================================================================

create table public.websites (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null check (char_length(name) between 1 and 80),
  -- registrable host without scheme, lower-case, e.g. "example.com"
  domain           text not null check (domain ~ '^[a-z0-9.-]{3,253}$'),
  base_url         text not null check (base_url ~ '^https?://' and char_length(base_url) <= 2048),
  preferred_domain text not null default 'as_entered' check (preferred_domain in ('as_entered', 'www', 'non_www')),
  country_code     char(2) not null default 'US' check (country_code ~ '^[A-Z]{2}$'),
  language_code    text not null default 'en' check (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  status           text not null default 'active' check (status in ('active', 'paused', 'archived')),
  is_demo          boolean not null default false,
  latest_score     numeric(5, 2) check (latest_score between 0 and 100),
  last_crawled_at  timestamptz,
  created_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, domain),
  unique (id, organization_id)
);

create index websites_org_idx on public.websites (organization_id);

create trigger websites_updated_at before update on public.websites
  for each row execute function private.set_updated_at();

create table public.website_settings (
  website_id            uuid primary key,
  organization_id       uuid not null,
  max_pages             integer not null default 100 check (max_pages between 1 and 10000),
  max_depth             integer not null default 5 check (max_depth between 0 and 20),
  crawl_delay_ms        integer not null default 250 check (crawl_delay_ms between 0 and 10000),
  respect_robots_txt    boolean not null default true,
  check_external_links  boolean not null default false,
  pagespeed_enabled     boolean not null default true,
  include_patterns      text[] not null default '{}',
  exclude_patterns      text[] not null default '{}',
  crawl_schedule        text not null default 'manual' check (crawl_schedule in ('manual', 'daily', 'weekly', 'monthly')),
  updated_at            timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  check (cardinality(include_patterns) <= 50 and cardinality(exclude_patterns) <= 50)
);

create trigger website_settings_updated_at before update on public.website_settings
  for each row execute function private.set_updated_at();

-- Auto-create default settings with every website.
create or replace function private.create_website_settings()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.website_settings (website_id, organization_id)
  values (new.id, new.organization_id)
  on conflict (website_id) do nothing;
  return new;
end;
$$;

create trigger websites_create_settings after insert on public.websites
  for each row execute function private.create_website_settings();

-- -----------------------------------------------------------------------------
-- Crawl jobs (queue table; a worker claims jobs with FOR UPDATE SKIP LOCKED)
-- -----------------------------------------------------------------------------
create table public.crawl_jobs (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  website_id        uuid not null,
  status            text not null default 'queued'
                      check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  trigger           text not null default 'manual' check (trigger in ('manual', 'scheduled', 'onboarding')),
  requested_by      uuid references auth.users (id) on delete set null,
  settings_snapshot jsonb not null default '{}'::jsonb,
  pages_discovered  integer not null default 0,
  pages_crawled     integer not null default 0,
  pages_failed      integer not null default 0,
  attempt           smallint not null default 0,
  locked_at         timestamptz,
  locked_by         text,
  error             text,
  started_at        timestamptz,
  finished_at       timestamptz,
  created_at        timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  unique (id, organization_id)
);

create index crawl_jobs_website_idx on public.crawl_jobs (website_id, created_at desc);
create index crawl_jobs_queue_idx on public.crawl_jobs (created_at) where status = 'queued';
-- only one active crawl per website
create unique index crawl_jobs_one_active_idx on public.crawl_jobs (website_id)
  where status in ('queued', 'running');

create table public.crawl_pages (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  crawl_job_id          uuid not null,
  website_id            uuid not null,
  url                   text not null,
  normalized_url        text not null,
  final_url             text,
  status_code           smallint,
  redirect_chain        jsonb not null default '[]'::jsonb,
  content_type          text,
  response_time_ms      integer,
  content_length        integer,
  depth                 smallint not null default 0,
  title                 text,
  meta_description      text,
  h1                    text[] not null default '{}',
  h2_count              smallint,
  canonical_url         text,
  robots_meta           text,
  x_robots_tag          text,
  lang                  text,
  word_count            integer,
  is_indexable          boolean,
  indexability_reason   text,
  internal_links_count  integer,
  external_links_count  integer,
  inbound_links_count   integer,
  images_count          integer,
  images_missing_alt    integer,
  has_viewport          boolean,
  structured_data_types text[] not null default '{}',
  open_graph            jsonb not null default '{}'::jsonb,
  twitter_card          jsonb not null default '{}'::jsonb,
  content_hash          text,
  -- extra analyzer output that does not deserve its own column
  details               jsonb not null default '{}'::jsonb,
  fetch_error           text,
  crawled_at            timestamptz not null default now(),
  foreign key (crawl_job_id, organization_id) references public.crawl_jobs (id, organization_id) on delete cascade,
  unique (crawl_job_id, normalized_url),
  unique (id, organization_id)
);

create index crawl_pages_website_idx on public.crawl_pages (website_id, normalized_url);

create table public.crawl_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  crawl_job_id    uuid not null,
  source_page_id  uuid not null,
  target_url      text not null,
  is_internal     boolean not null,
  is_nofollow     boolean not null default false,
  anchor_text     text,
  target_status   smallint,
  foreign key (crawl_job_id, organization_id) references public.crawl_jobs (id, organization_id) on delete cascade,
  foreign key (source_page_id, organization_id) references public.crawl_pages (id, organization_id) on delete cascade
);

create index crawl_links_job_target_idx on public.crawl_links (crawl_job_id, target_url);
create index crawl_links_source_idx on public.crawl_links (source_page_id);

-- -----------------------------------------------------------------------------
-- Audits: one per completed crawl. Score is derived from stored seo_checks.
-- -----------------------------------------------------------------------------
create table public.seo_audits (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null,
  website_id        uuid not null,
  crawl_job_id      uuid unique,
  scoring_version   text not null,
  score             numeric(5, 2) not null check (score between 0 and 100),
  score_breakdown   jsonb not null default '{}'::jsonb,
  pages_analyzed    integer not null default 0,
  critical_count    integer not null default 0,
  warning_count     integer not null default 0,
  opportunity_count integer not null default 0,
  passed_count      integer not null default 0,
  created_at        timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  foreign key (crawl_job_id, organization_id) references public.crawl_jobs (id, organization_id) on delete set null (crawl_job_id),
  unique (id, organization_id)
);

create index seo_audits_website_idx on public.seo_audits (website_id, created_at desc);

create type public.seo_severity as enum ('critical', 'warning', 'opportunity', 'passed');

create table public.seo_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  audit_id        uuid not null,
  rule_id         text not null check (rule_id ~ '^[a-z0-9_.]{2,64}$'),
  category        text not null,
  severity        public.seo_severity not null,
  -- 'passed' | 'failed' | 'not_applicable'
  result          text not null check (result in ('passed', 'failed', 'not_applicable')),
  weight          numeric(6, 2) not null check (weight >= 0),
  -- fraction of the rule's weight earned, 0..1
  rule_score      numeric(5, 4) not null check (rule_score between 0 and 1),
  affected_count  integer not null default 0,
  total_count     integer not null default 0,
  explanation     text not null,
  recommendation  text not null,
  details         jsonb not null default '{}'::jsonb,
  foreign key (audit_id, organization_id) references public.seo_audits (id, organization_id) on delete cascade,
  unique (audit_id, rule_id)
);

-- Issues persist across audits so we can show detection and fixed dates.
create table public.seo_issues (
  id                   uuid primary key default gen_random_uuid(),
  organization_id      uuid not null,
  website_id           uuid not null,
  rule_id              text not null,
  fingerprint          text not null,
  title                text not null,
  explanation          text not null,
  recommendation       text not null,
  severity             public.seo_severity not null check (severity <> 'passed'),
  status               text not null default 'open' check (status in ('open', 'fixed', 'ignored')),
  affected_pages_count integer not null default 0,
  first_detected_at    timestamptz not null default now(),
  last_detected_at     timestamptz not null default now(),
  last_audit_id        uuid,
  fixed_at             timestamptz,
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  unique (website_id, fingerprint),
  unique (id, organization_id)
);

create index seo_issues_website_status_idx on public.seo_issues (website_id, status, severity);

create table public.seo_issue_pages (
  issue_id        uuid not null,
  organization_id uuid not null,
  url             text not null,
  details         jsonb not null default '{}'::jsonb,
  primary key (issue_id, url),
  foreign key (issue_id, organization_id) references public.seo_issues (id, organization_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.websites         enable row level security;
alter table public.website_settings enable row level security;
alter table public.crawl_jobs       enable row level security;
alter table public.crawl_pages      enable row level security;
alter table public.crawl_links      enable row level security;
alter table public.seo_audits       enable row level security;
alter table public.seo_checks       enable row level security;
alter table public.seo_issues       enable row level security;
alter table public.seo_issue_pages  enable row level security;

-- websites: members read; members+ create/update; admins+ delete
create policy websites_select on public.websites for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy websites_insert on public.websites for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')) and is_demo = false);
create policy websites_update on public.websites for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));
create policy websites_delete on public.websites for delete to authenticated
  using ((select private.has_org_role(organization_id, 'admin')));

create policy website_settings_select on public.website_settings for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy website_settings_update on public.website_settings for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));

-- crawl data: read-only for members; jobs are created/processed by the server.
create policy crawl_jobs_select on public.crawl_jobs for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy crawl_pages_select on public.crawl_pages for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy crawl_links_select on public.crawl_links for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy seo_audits_select on public.seo_audits for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy seo_checks_select on public.seo_checks for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy seo_issues_select on public.seo_issues for select to authenticated
  using ((select private.is_org_member(organization_id)));
-- members may ignore / reopen issues (column grant limits this to status)
create policy seo_issues_update on public.seo_issues for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));
create policy seo_issue_pages_select on public.seo_issue_pages for select to authenticated
  using ((select private.is_org_member(organization_id)));
