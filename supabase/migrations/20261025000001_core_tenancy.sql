-- =============================================================================
-- Rankora — 0001 Core tenancy
-- profiles, organizations, organization_members, platform_admins, plans,
-- subscriptions, usage_records, audit_logs, notifications, rate limiting.
--
-- Ownership model:  auth.users -> organization_members -> organizations
--                   organizations -> websites -> (all SEO data)
-- Every tenant-scoped table carries organization_id so RLS can be evaluated
-- with one indexed membership lookup.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles (1:1 with auth.users)
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text check (char_length(full_name) <= 120),
  avatar_url  text check (char_length(avatar_url) <= 2048),
  timezone    text not null default 'UTC' check (char_length(timezone) <= 64),
  last_organization_id uuid,
  onboarding_completed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- Create a profile automatically when a user signs up.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- -----------------------------------------------------------------------------
-- organizations + members
-- -----------------------------------------------------------------------------
create table public.plans (
  id                  text primary key check (id ~ '^[a-z0-9_]{2,32}$'),
  name                text not null,
  description         text,
  price_monthly_cents integer not null default 0 check (price_monthly_cents >= 0),
  -- e.g. {"websites":1,"crawl_pages_per_month":500,"tracked_keywords":50}
  limits              jsonb not null default '{}'::jsonb,
  is_active           boolean not null default true,
  sort_order          smallint not null default 0,
  created_at          timestamptz not null default now()
);

create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 80),
  slug        text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$'),
  plan_id     text not null default 'free' references public.plans (id),
  is_demo     boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();

create type public.org_role as enum ('owner', 'admin', 'member', 'viewer');

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            public.org_role not null default 'member',
  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- RLS lookups go by (user_id, organization_id); the PK covers the reverse.
create index organization_members_user_idx on public.organization_members (user_id, organization_id);

alter table public.profiles
  add constraint profiles_last_org_fk foreign key (last_organization_id)
  references public.organizations (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Authorization helpers (SECURITY DEFINER so they can read membership without
-- recursive RLS). They always evaluate against auth.uid() of the caller.
-- -----------------------------------------------------------------------------
create or replace function private.role_rank(r public.org_role)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case r
    when 'owner'  then 4
    when 'admin'  then 3
    when 'member' then 2
    when 'viewer' then 1
  end;
$$;

create or replace function private.is_org_member(org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
  );
$$;

-- True when the caller's role in org_id is at least min_role.
create or replace function private.has_org_role(org_id uuid, min_role public.org_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = (select auth.uid())
      and private.role_rank(m.role) >= private.role_rank(min_role)
  );
$$;

-- Prevent an organization from losing its last owner.
create or replace function private.protect_last_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  remaining integer;
begin
  if (tg_op = 'DELETE' and old.role = 'owner')
     or (tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner') then
    -- Cascading delete of the whole organization is fine.
    if not exists (select 1 from public.organizations o where o.id = old.organization_id) then
      return coalesce(new, old);
    end if;
    select count(*) into remaining
    from public.organization_members
    where organization_id = old.organization_id
      and role = 'owner'
      and user_id <> old.user_id;
    if remaining = 0 then
      raise exception 'An organization must keep at least one owner'
        using errcode = 'check_violation';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger organization_members_protect_owner
  before update or delete on public.organization_members
  for each row execute function private.protect_last_owner();

-- Only owners may grant or hold-change the owner role.
create or replace function private.guard_owner_grant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- service_role / migrations (no auth.uid()) are trusted.
  if (select auth.uid()) is null then
    return new;
  end if;
  -- Bootstrap: the creator becomes the first owner of an empty organization.
  if tg_op = 'INSERT'
     and new.user_id = (select auth.uid())
     and not exists (select 1 from public.organization_members m where m.organization_id = new.organization_id)
     and exists (select 1 from public.organizations o
                 where o.id = new.organization_id and o.created_by = (select auth.uid())) then
    return new;
  end if;
  if new.role = 'owner' and not private.has_org_role(new.organization_id, 'owner') then
    raise exception 'Only owners can grant the owner role'
      using errcode = 'insufficient_privilege';
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and not private.has_org_role(new.organization_id, 'owner') then
    raise exception 'Only owners can change another owner''s role'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

create trigger organization_members_guard_owner
  before insert or update on public.organization_members
  for each row execute function private.guard_owner_grant();

-- -----------------------------------------------------------------------------
-- Platform administration (separate from tenant roles)
-- -----------------------------------------------------------------------------
create table public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  -- support: operational metadata only. superadmin: may also open customer
  -- data through audited server endpoints.
  role       text not null check (role in ('support', 'superadmin')),
  granted_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function private.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

-- -----------------------------------------------------------------------------
-- Billing architecture (provider-agnostic; Stripe can be plugged in later)
-- -----------------------------------------------------------------------------
create table public.subscriptions (
  id                        uuid primary key default gen_random_uuid(),
  organization_id           uuid not null unique references public.organizations (id) on delete cascade,
  plan_id                   text not null references public.plans (id),
  status                    text not null default 'active'
                              check (status in ('trialing', 'active', 'past_due', 'canceled', 'incomplete')),
  provider                  text not null default 'none' check (provider in ('none', 'stripe', 'manual')),
  provider_customer_id      text,
  provider_subscription_id  text unique,
  current_period_start      timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean not null default false,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger subscriptions_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();

create table public.usage_records (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id      uuid,
  metric          text not null check (metric in (
                    'crawl_pages', 'keyword_lookups', 'rank_checks',
                    'pagespeed_calls', 'ai_requests', 'backlink_lookups', 'reports')),
  quantity        integer not null check (quantity > 0),
  occurred_at     timestamptz not null default now(),
  metadata        jsonb not null default '{}'::jsonb
);

create index usage_records_org_metric_idx on public.usage_records (organization_id, metric, occurred_at desc);

-- -----------------------------------------------------------------------------
-- Audit log + notifications + system events
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null check (char_length(action) <= 80),
  entity_type     text check (char_length(entity_type) <= 60),
  entity_id       uuid,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id);

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete cascade,
  type            text not null check (char_length(type) <= 60),
  title           text not null check (char_length(title) <= 200),
  body            text check (char_length(body) <= 2000),
  link            text check (char_length(link) <= 500),
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;

create table public.system_events (
  id         uuid primary key default gen_random_uuid(),
  level      text not null check (level in ('debug', 'info', 'warn', 'error')),
  source     text not null check (char_length(source) <= 80),
  message    text not null check (char_length(message) <= 4000),
  context    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index system_events_level_idx on public.system_events (level, created_at desc);

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed window, keyed per user). Callable by signed-in users;
-- the key is always bound to auth.uid() so a user can only spend their own budget.
-- -----------------------------------------------------------------------------
create table private.rate_limits (
  key          text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);

create or replace function public.rate_limit_hit(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  win timestamptz;
  current_hits integer;
begin
  if uid is null then
    return false;
  end if;
  if p_bucket !~ '^[a-z0-9_:.-]{1,64}$' or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;
  win := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into private.rate_limits as rl (key, window_start, hits)
  values (p_bucket || ':' || uid::text, win, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into current_hits;

  -- opportunistic cleanup of stale windows
  delete from private.rate_limits where window_start < now() - interval '2 days';

  return current_hits <= p_limit;
end;
$$;

-- -----------------------------------------------------------------------------
-- Organization creation RPC: atomically creates org, owner membership and a
-- free subscription. Returns the new organization id.
-- -----------------------------------------------------------------------------
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  org_id uuid;
  owned_count integer;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into owned_count
  from public.organization_members where user_id = uid and role = 'owner';
  if owned_count >= 10 then
    raise exception 'Organization limit reached' using errcode = 'check_violation';
  end if;

  insert into public.organizations (name, slug, created_by)
  values (trim(p_name), lower(trim(p_slug)), uid)
  returning id into org_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (org_id, uid, 'owner');

  insert into public.subscriptions (organization_id, plan_id, status, provider)
  values (org_id, 'free', 'active', 'none');

  update public.profiles set last_organization_id = org_id where id = uid;

  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
  values (org_id, uid, 'organization.created', 'organization', org_id);

  return org_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.organizations        enable row level security;
alter table public.organization_members enable row level security;
alter table public.platform_admins      enable row level security;
alter table public.plans                enable row level security;
alter table public.subscriptions        enable row level security;
alter table public.usage_records        enable row level security;
alter table public.audit_logs           enable row level security;
alter table public.notifications        enable row level security;
alter table public.system_events        enable row level security;

-- profiles: own row; also visible to people who share an organization
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.organization_members mine
      join public.organization_members theirs on theirs.organization_id = mine.organization_id
      where mine.user_id = (select auth.uid()) and theirs.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- organizations
create policy organizations_select on public.organizations for select to authenticated
  using ((select private.is_org_member(id)));
create policy organizations_update on public.organizations for update to authenticated
  using ((select private.has_org_role(id, 'admin')))
  with check ((select private.has_org_role(id, 'admin')));
create policy organizations_delete on public.organizations for delete to authenticated
  using ((select private.has_org_role(id, 'owner')));
-- (insert happens through create_organization())

-- organization_members
create policy members_select on public.organization_members for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy members_insert on public.organization_members for insert to authenticated
  with check ((select private.has_org_role(organization_id, 'admin')));
create policy members_update on public.organization_members for update to authenticated
  using ((select private.has_org_role(organization_id, 'admin')))
  with check ((select private.has_org_role(organization_id, 'admin')));
create policy members_delete on public.organization_members for delete to authenticated
  using (
    (select private.has_org_role(organization_id, 'admin'))
    or user_id = (select auth.uid())  -- leave an organization
  );

-- platform_admins: a user may see their own admin row only
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = (select auth.uid()));

-- plans: public catalog
create policy plans_read on public.plans for select to anon, authenticated
  using (is_active);

-- subscriptions / usage: members read; written by server (service role) only
create policy subscriptions_select on public.subscriptions for select to authenticated
  using ((select private.is_org_member(organization_id)));
create policy usage_select on public.usage_records for select to authenticated
  using ((select private.is_org_member(organization_id)));

-- audit logs: org admins read
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (organization_id is not null and (select private.has_org_role(organization_id, 'admin')));

-- notifications: personal
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy notifications_delete on public.notifications for delete to authenticated
  using (user_id = (select auth.uid()));

-- system_events: no client access (service role only)

-- Seed plan catalog
insert into public.plans (id, name, description, price_monthly_cents, limits, sort_order) values
  ('free',   'Free',   'For trying Rankora on one site.', 0,
     '{"websites":1,"crawl_pages_per_audit":100,"tracked_keywords":25,"keyword_lookups_per_month":50,"members":2}', 0),
  ('pro',    'Pro',    'For professionals managing a few sites.', 2900,
     '{"websites":5,"crawl_pages_per_audit":1000,"tracked_keywords":500,"keyword_lookups_per_month":1000,"members":5}', 1),
  ('agency', 'Agency', 'For agencies and in-house teams.', 9900,
     '{"websites":25,"crawl_pages_per_audit":5000,"tracked_keywords":2500,"keyword_lookups_per_month":5000,"members":25}', 2)
on conflict (id) do nothing;
