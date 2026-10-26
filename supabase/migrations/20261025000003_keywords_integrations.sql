-- =============================================================================
-- Rankora — 0003 Keywords, rank tracking, integrations and synced analytics
-- Metrics tables carry a `source` column so the UI can label data truthfully
-- (e.g. 'gsc' vs 'demo'); nothing is labelled Google data unless it came from
-- a connected Google integration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Keywords
-- -----------------------------------------------------------------------------
create table public.keywords (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null,
  website_id         uuid not null,
  keyword            text not null check (char_length(keyword) between 1 and 200),
  normalized_keyword text not null,
  country_code       char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  language_code      text not null check (language_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  device             text not null default 'desktop' check (device in ('desktop', 'mobile')),
  search_engine      text not null default 'google' check (search_engine in ('google', 'bing')),
  -- provider metrics; NULL means "not fetched", never zero-by-default
  search_volume      integer check (search_volume >= 0),
  cpc                numeric(10, 2) check (cpc >= 0),
  competition        numeric(4, 3) check (competition between 0 and 1),
  difficulty         smallint check (difficulty between 0 and 100),
  intent             text check (intent in ('informational', 'navigational', 'commercial', 'transactional')),
  metrics_source     text,
  metrics_fetched_at timestamptz,
  target_url         text check (char_length(target_url) <= 2048),
  is_tracked         boolean not null default false,
  notes              text check (char_length(notes) <= 2000),
  created_by         uuid references auth.users (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  unique (website_id, normalized_keyword, country_code, language_code, device, search_engine),
  unique (id, organization_id)
);

create index keywords_website_tracked_idx on public.keywords (website_id) where is_tracked;

create trigger keywords_updated_at before update on public.keywords
  for each row execute function private.set_updated_at();

create table public.keyword_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid not null,
  name            text not null check (char_length(name) between 1 and 80),
  kind            text not null default 'list' check (kind in ('list', 'rank_group', 'cluster')),
  color           text check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at      timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  unique (website_id, kind, name),
  unique (id, organization_id)
);

create table public.keyword_group_members (
  group_id        uuid not null,
  keyword_id      uuid not null,
  organization_id uuid not null,
  added_at        timestamptz not null default now(),
  primary key (group_id, keyword_id),
  foreign key (group_id, organization_id) references public.keyword_groups (id, organization_id) on delete cascade,
  foreign key (keyword_id, organization_id) references public.keywords (id, organization_id) on delete cascade
);

create index keyword_group_members_keyword_idx on public.keyword_group_members (keyword_id);

-- Historical rank snapshots (one per keyword per day)
create table public.keyword_rankings (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  keyword_id      uuid not null,
  checked_on      date not null,
  checked_at      timestamptz not null default now(),
  -- NULL = not found in the checked depth (e.g. top 100)
  position        smallint check (position between 1 and 200),
  ranking_url     text,
  serp_features   text[] not null default '{}',
  source          text not null,
  foreign key (keyword_id, organization_id) references public.keywords (id, organization_id) on delete cascade,
  unique (keyword_id, checked_on)
);

create index keyword_rankings_keyword_date_idx on public.keyword_rankings (keyword_id, checked_on desc);

-- Cached results of provider keyword research (saves cost, auditability)
create table public.keyword_research_queries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  website_id      uuid,
  seed            text not null check (char_length(seed) between 1 and 200),
  country_code    char(2) not null,
  language_code   text not null,
  provider        text not null,
  status          text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  results         jsonb not null default '[]'::jsonb,
  error           text,
  requested_by    uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (organization_id) references public.organizations (id) on delete cascade
);

create index keyword_research_lookup_idx
  on public.keyword_research_queries (organization_id, lower(seed), country_code, language_code, created_at desc);

-- -----------------------------------------------------------------------------
-- OAuth + integrations
-- -----------------------------------------------------------------------------
create table public.oauth_connections (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references public.organizations (id) on delete cascade,
  connected_by             uuid references auth.users (id) on delete set null,
  provider                 text not null check (provider in ('google')),
  provider_account_email   text,
  scopes                   text[] not null default '{}',
  -- AES-256-GCM ciphertext produced server-side (see src/lib/security/crypto.ts).
  -- Never readable by the authenticated role (column grants below).
  access_token_encrypted   text,
  refresh_token_encrypted  text,
  token_expires_at         timestamptz,
  revoked_at               timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (id, organization_id)
);

create trigger oauth_connections_updated_at before update on public.oauth_connections
  for each row execute function private.set_updated_at();

-- One-time OAuth state, hashed. Service role only.
create table public.oauth_states (
  id              uuid primary key default gen_random_uuid(),
  state_hash      text not null unique,
  user_id         uuid not null references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id      uuid references public.websites (id) on delete cascade,
  provider        text not null,
  code_verifier_encrypted text,
  redirect_path   text not null default '/app' check (redirect_path ~ '^/[A-Za-z0-9/_-]*$'),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  created_at      timestamptz not null default now()
);

create table public.integrations (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid not null,
  website_id            uuid not null,
  provider              text not null check (provider in (
                          'google_search_console', 'google_analytics_4', 'pagespeed_insights',
                          'keyword_provider', 'backlink_provider')),
  status                text not null default 'disconnected'
                          check (status in ('disconnected', 'pending', 'connected', 'error')),
  oauth_connection_id   uuid,
  -- e.g. 'sc-domain:example.com' or 'properties/123456789'
  external_account_id   text,
  external_account_name text,
  config                jsonb not null default '{}'::jsonb,
  last_synced_at        timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade,
  foreign key (oauth_connection_id, organization_id) references public.oauth_connections (id, organization_id) on delete set null (oauth_connection_id),
  unique (website_id, provider),
  unique (id, organization_id)
);

create trigger integrations_updated_at before update on public.integrations
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Synced metrics (GA4 / GSC). 'all' is used as the roll-up dimension value.
-- -----------------------------------------------------------------------------
create table public.analytics_daily (
  organization_id     uuid not null,
  website_id          uuid not null,
  date                date not null,
  channel             text not null default 'all',
  device              text not null default 'all',
  country             text not null default 'all',
  source              text not null check (source in ('ga4', 'demo')),
  users               integer not null default 0,
  new_users           integer not null default 0,
  sessions            integer not null default 0,
  engaged_sessions    integer not null default 0,
  page_views          integer not null default 0,
  engagement_rate     numeric(6, 5),
  avg_engagement_time_seconds numeric(10, 2),
  synced_at           timestamptz not null default now(),
  primary key (website_id, date, channel, device, country),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table public.analytics_pages (
  organization_id  uuid not null,
  website_id       uuid not null,
  date             date not null,
  page_path        text not null,
  is_landing       boolean not null default false,
  source           text not null check (source in ('ga4', 'demo')),
  users            integer not null default 0,
  sessions         integer not null default 0,
  engaged_sessions integer not null default 0,
  page_views       integer not null default 0,
  organic_sessions integer,
  synced_at        timestamptz not null default now(),
  primary key (website_id, date, page_path, is_landing),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table public.search_console_daily (
  organization_id uuid not null,
  website_id      uuid not null,
  date            date not null,
  device          text not null default 'all',
  country         text not null default 'all',
  source          text not null check (source in ('gsc', 'demo')),
  clicks          integer not null default 0,
  impressions     integer not null default 0,
  ctr             numeric(7, 6),
  position        numeric(7, 2),
  synced_at       timestamptz not null default now(),
  primary key (website_id, date, device, country),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table public.search_console_queries (
  organization_id uuid not null,
  website_id      uuid not null,
  date            date not null,
  query           text not null,
  source          text not null check (source in ('gsc', 'demo')),
  clicks          integer not null default 0,
  impressions     integer not null default 0,
  ctr             numeric(7, 6),
  position        numeric(7, 2),
  synced_at       timestamptz not null default now(),
  primary key (website_id, date, query),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

create table public.search_console_pages (
  organization_id uuid not null,
  website_id      uuid not null,
  date            date not null,
  page            text not null,
  source          text not null check (source in ('gsc', 'demo')),
  clicks          integer not null default 0,
  impressions     integer not null default 0,
  ctr             numeric(7, 6),
  position        numeric(7, 2),
  synced_at       timestamptz not null default now(),
  primary key (website_id, date, page),
  foreign key (website_id, organization_id) references public.websites (id, organization_id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.keywords                 enable row level security;
alter table public.keyword_groups           enable row level security;
alter table public.keyword_group_members    enable row level security;
alter table public.keyword_rankings         enable row level security;
alter table public.keyword_research_queries enable row level security;
alter table public.oauth_connections        enable row level security;
alter table public.oauth_states             enable row level security;
alter table public.integrations             enable row level security;
alter table public.analytics_daily          enable row level security;
alter table public.analytics_pages          enable row level security;
alter table public.search_console_daily     enable row level security;
alter table public.search_console_queries   enable row level security;
alter table public.search_console_pages     enable row level security;

-- user-editable (members+ write, all members read)
create policy keywords_select on public.keywords for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy keywords_write on public.keywords for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')));
create policy keywords_update on public.keywords for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));
create policy keywords_delete on public.keywords for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

create policy keyword_groups_select on public.keyword_groups for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy keyword_groups_insert on public.keyword_groups for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')));
create policy keyword_groups_update on public.keyword_groups for update to authenticated
  using ((select private.has_org_role(organization_id, 'member')))
  with check ((select private.has_org_role(organization_id, 'member')));
create policy keyword_groups_delete on public.keyword_groups for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

create policy kgm_select on public.keyword_group_members for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy kgm_insert on public.keyword_group_members for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'member')));
create policy kgm_delete on public.keyword_group_members for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member')));

-- server-written, member-readable
create policy keyword_rankings_select on public.keyword_rankings for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy keyword_research_select on public.keyword_research_queries for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy oauth_connections_select on public.oauth_connections for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy integrations_select on public.integrations for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy analytics_daily_select on public.analytics_daily for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy analytics_pages_select on public.analytics_pages for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy gsc_daily_select on public.search_console_daily for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy gsc_queries_select on public.search_console_queries for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy gsc_pages_select on public.search_console_pages for select to authenticated
  using ((select private.is_org_member(organization_id)));
-- oauth_states: no policies (service role only)
