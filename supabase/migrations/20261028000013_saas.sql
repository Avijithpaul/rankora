-- =============================================================================
-- Phase 8 — SaaS readiness
--   * plan catalog: Free / Starter / Pro / Agency with one set of limit keys
--   * subscriptions are the source of truth; organizations.plan_id is derived
--   * billing_events for idempotent provider webhooks
--   * usage: ai_credits metric, usage_summary(), DB-level member limit
--   * team invitations (members can no longer be inserted directly by clients)
--   * notification helper, system event retention index
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Plans
-- -----------------------------------------------------------------------------
alter table public.plans add column features jsonb not null default '[]'::jsonb;

insert into public.plans (id, name, description, price_monthly_cents, limits, features, sort_order) values
  ('free', 'Free', 'For trying Rankora on one site.', 0,
   '{"websites":1,"members":2,"crawl_pages_per_month":500,"crawl_pages_per_audit":100,"tracked_keywords":25,"rank_checks_per_month":750,"keyword_lookups_per_month":50,"reports_per_month":5,"ai_credits_per_month":20,"backlink_lookups_per_month":0}',
   '["Site audit","Keyword tracking","Search Console & GA4","Reports"]', 0),
  ('starter', 'Starter', 'For freelancers and small sites.', 1200,
   '{"websites":3,"members":3,"crawl_pages_per_month":5000,"crawl_pages_per_audit":500,"tracked_keywords":150,"rank_checks_per_month":4500,"keyword_lookups_per_month":300,"reports_per_month":30,"ai_credits_per_month":100,"backlink_lookups_per_month":2}',
   '["Everything in Free","Competitor tracking","Content Optimizer AI credits","Backlink syncs"]', 1),
  ('pro', 'Pro', 'For professionals managing a few sites.', 2900,
   '{"websites":5,"members":5,"crawl_pages_per_month":25000,"crawl_pages_per_audit":1000,"tracked_keywords":500,"rank_checks_per_month":15000,"keyword_lookups_per_month":1000,"reports_per_month":100,"ai_credits_per_month":500,"backlink_lookups_per_month":10}',
   '["Everything in Starter","Larger audits","More AI credits","Priority support"]', 2),
  ('agency', 'Agency', 'For agencies and in-house teams.', 9900,
   '{"websites":25,"members":25,"crawl_pages_per_month":150000,"crawl_pages_per_audit":5000,"tracked_keywords":2500,"rank_checks_per_month":75000,"keyword_lookups_per_month":5000,"reports_per_month":500,"ai_credits_per_month":2500,"backlink_lookups_per_month":50}',
   '["Everything in Pro","25 websites and team members","Highest limits"]', 3)
on conflict (id) do update
  set name = excluded.name, description = excluded.description, price_monthly_cents = excluded.price_monthly_cents,
      limits = excluded.limits, features = excluded.features, sort_order = excluded.sort_order;

-- -----------------------------------------------------------------------------
-- Subscriptions → organizations.plan_id (single source of truth)
-- -----------------------------------------------------------------------------
alter table public.subscriptions add column trial_end timestamptz;

create or replace function private.sync_org_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organizations
     set plan_id = case when new.status in ('active', 'trialing', 'past_due') then new.plan_id else 'free' end
   where id = new.organization_id;
  return new;
end;
$$;

create trigger subscriptions_sync_plan after insert or update of plan_id, status on public.subscriptions
  for each row execute function private.sync_org_plan();

-- organizations created before this migration may lack a subscription row
insert into public.subscriptions (organization_id, plan_id, status, provider)
select o.id, o.plan_id, 'active', 'none' from public.organizations o
where not exists (select 1 from public.subscriptions s where s.organization_id = o.id);

create table public.billing_events (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null check (provider in ('stripe', 'manual')),
  event_id     text not null,
  type         text not null,
  organization_id uuid references public.organizations (id) on delete set null,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error        text check (char_length(error) <= 1000),
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- -----------------------------------------------------------------------------
-- Usage
-- -----------------------------------------------------------------------------
alter table public.usage_records drop constraint usage_records_metric_check;
alter table public.usage_records add constraint usage_records_metric_check check (metric in (
  'crawl_pages', 'keyword_lookups', 'rank_checks', 'pagespeed_calls', 'ai_requests', 'ai_credits', 'backlink_lookups', 'reports'));

-- Usage in the current calendar month (UTC), per metric.
create or replace function public.usage_summary(p_org uuid)
returns table (metric text, used bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select u.metric, sum(u.quantity)::bigint
  from public.usage_records u
  where u.organization_id = p_org
    and u.occurred_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  group by u.metric;
$$;

-- The member limit is enforced in the database, so no code path can exceed it.
create or replace function private.enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit int;
  v_count int;
begin
  select coalesce((p.limits ->> 'members')::int, 2) into v_limit
  from public.organizations o join public.plans p on p.id = o.plan_id
  where o.id = new.organization_id;
  select count(*) into v_count from public.organization_members where organization_id = new.organization_id;
  if v_count >= v_limit then
    raise exception 'Member limit reached for this plan (% members)', v_limit using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger organization_members_limit before insert on public.organization_members
  for each row execute function private.enforce_member_limit();

-- -----------------------------------------------------------------------------
-- Limits and invariants enforced in the database as well (clients could
-- otherwise skip the server actions and call the Data API directly)
-- -----------------------------------------------------------------------------
create or replace function private.plan_limit(p_org uuid, p_key text, p_default int)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((p.limits ->> p_key)::int, p_default)
  from public.organizations o join public.plans p on p.id = o.plan_id
  where o.id = p_org;
$$;

create or replace function private.enforce_website_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host text := lower(regexp_replace(substring(new.base_url from '^https?://([^/:?#]+)'), '^www\.', ''));
begin
  if v_host is null or v_host <> regexp_replace(new.domain, '^www\.', '') then
    raise exception 'The website URL must be on its domain (%)', new.domain using errcode = 'check_violation';
  end if;
  -- non-members are left to RLS (no information about another tenant's usage)
  if tg_op = 'INSERT' and (select auth.uid()) is not null and private.is_org_member(new.organization_id)
     and (select count(*) from public.websites w where w.organization_id = new.organization_id) >= private.plan_limit(new.organization_id, 'websites', 1) then
    raise exception 'Website limit reached for this plan' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger websites_rules before insert or update of base_url, domain on public.websites
  for each row execute function private.enforce_website_rules();

create or replace function private.enforce_tracked_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_tracked and (tg_op = 'INSERT' or not old.is_tracked) and (select auth.uid()) is not null
     and private.is_org_member(new.organization_id)
     and (select count(*) from public.keywords k where k.organization_id = new.organization_id and k.is_tracked)
         >= private.plan_limit(new.organization_id, 'tracked_keywords', 25) then
    raise exception 'Tracked keyword limit reached for this plan' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger keywords_tracked_limit before insert or update of is_tracked on public.keywords
  for each row execute function private.enforce_tracked_limit();

create or replace function private.enforce_competitor_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if ((select auth.uid()) is null or private.is_org_member(new.organization_id))
     and (select count(*) from public.competitors c where c.website_id = new.website_id) >= 10 then
    raise exception 'Up to 10 competitors per website' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger competitors_limit before insert on public.competitors
  for each row execute function private.enforce_competitor_limit();

-- only http(s) URLs or site-relative paths in user-editable URL fields
alter table public.seo_tasks add constraint seo_tasks_page_url_scheme check (page_url ~ '^(https?://|/)') not valid;
alter table public.keywords add constraint keywords_target_url_scheme check (target_url ~ '^(https?://|/)') not valid;

-- Only owners may remove an owner (anyone may still leave on their own).
create or replace function private.guard_owner_removal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and old.role = 'owner'
     and old.user_id <> (select auth.uid())
     and not private.has_org_role(old.organization_id, 'owner') then
    raise exception 'Only owners can remove an owner' using errcode = 'insufficient_privilege';
  end if;
  return old;
end;
$$;

create trigger organization_members_owner_removal before delete on public.organization_members
  for each row execute function private.guard_owner_removal();

-- -----------------------------------------------------------------------------
-- Team invitations
-- -----------------------------------------------------------------------------
-- Clients may no longer add arbitrary users to an organization; membership is
-- created by create_organization() or by accepting an invitation (server).
drop policy members_insert on public.organization_members;
revoke insert on public.organization_members from authenticated;

create table public.organization_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  email           text not null check (email = lower(email) and char_length(email) between 3 and 254),
  role            public.org_role not null default 'member' check (role <> 'owner'),
  token_hash      text not null unique check (char_length(token_hash) = 64),
  invited_by      uuid references auth.users (id) on delete set null,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);

create unique index organization_invitations_open_idx on public.organization_invitations (organization_id, email)
  where accepted_at is null and revoked_at is null;

alter table public.organization_invitations enable row level security;
create policy invitations_select on public.organization_invitations for select to authenticated
  using ((select private.has_org_role(organization_id, 'admin')));
grant select (id, organization_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on public.organization_invitations to authenticated;
grant all on public.organization_invitations, public.billing_events to service_role;
alter table public.billing_events enable row level security;

-- Is this email already a member? Reads auth.users, so service role only.
create or replace function public.org_member_by_email(p_org uuid, p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.organization_members m join auth.users u on u.id = m.user_id
    where m.organization_id = p_org and lower(u.email) = lower(p_email)
  );
$$;
revoke all on function public.org_member_by_email(uuid, text) from public, anon, authenticated;
grant execute on function public.org_member_by_email(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Monitoring
-- -----------------------------------------------------------------------------
create index system_events_created_idx on public.system_events (created_at desc);
create index crawl_jobs_status_created_idx on public.crawl_jobs (status, created_at desc);

revoke all on function public.usage_summary(uuid) from public, anon;
grant execute on function public.usage_summary(uuid) to authenticated, service_role;
