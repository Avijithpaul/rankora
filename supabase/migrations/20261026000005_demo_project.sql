-- =============================================================================
-- Rankora — 0005 Demo Project
--
-- create_demo_project(payload) creates ONE demo organization per user, with a
-- demo website and sample data. Guarantees enforced here (not by the caller):
--   * organizations.is_demo = true and websites.is_demo = true
--   * every metric row is written with source / metrics_source = 'demo'
--   * all rows are attached to the newly created demo org + website only
--     (ids in the payload are ignored), so the function cannot write into any
--     other tenant's data
--   * payload sizes are capped
-- The UI labels everything from a demo org/website as "Demo Data".
-- =============================================================================

-- Real websites cannot be added to a demo organization.
drop policy websites_insert on public.websites;
create policy websites_insert on public.websites for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, 'member'))
    and is_demo = false
    and not exists (select 1 from public.organizations o where o.id = organization_id and o.is_demo)
  );

create or replace function public.create_demo_project(p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid       uuid := (select auth.uid());
  v_org     uuid;
  v_slug    text;
  v_site    uuid;
  v_audit   uuid;
  v_issue   uuid;
  v_kw      uuid;
  w         jsonb := p_data -> 'website';
  a         jsonb := p_data -> 'audit';
  r         jsonb;
begin
  if uid is null then
    raise exception 'Not authenticated' using errcode = 'insufficient_privilege';
  end if;

  -- One demo project per user: return the existing one.
  select o.id, o.slug into v_org, v_slug
  from public.organizations o
  join public.organization_members m on m.organization_id = o.id and m.user_id = uid
  where o.is_demo
  limit 1;
  if v_org is not null then
    select id into v_site from public.websites where organization_id = v_org order by created_at limit 1;
    return jsonb_build_object('slug', v_slug, 'website_id', v_site, 'created', false);
  end if;

  -- Size limits
  if jsonb_typeof(w) <> 'object' or jsonb_typeof(a) <> 'object'
     or coalesce(jsonb_array_length(a -> 'checks'), 0) > 100
     or coalesce(jsonb_array_length(p_data -> 'issues'), 0) > 100
     or coalesce(jsonb_array_length(p_data -> 'gsc_daily'), 0) > 400
     or coalesce(jsonb_array_length(p_data -> 'ga_daily'), 0) > 400
     or coalesce(jsonb_array_length(p_data -> 'gsc_queries'), 0) > 3000
     or coalesce(jsonb_array_length(p_data -> 'gsc_pages'), 0) > 3000
     or coalesce(jsonb_array_length(p_data -> 'keywords'), 0) > 50 then
    raise exception 'Demo payload too large' using errcode = 'check_violation';
  end if;

  v_slug := 'demo-' || substr(replace(uid::text, '-', ''), 1, 12);

  insert into public.organizations (name, slug, is_demo, created_by)
  values ('Demo Project', v_slug, true, uid)
  returning id into v_org;

  insert into public.organization_members (organization_id, user_id, role) values (v_org, uid, 'owner');
  insert into public.subscriptions (organization_id, plan_id, status, provider) values (v_org, 'free', 'active', 'none');

  insert into public.websites (organization_id, name, domain, base_url, country_code, language_code, is_demo, created_by)
  values (v_org, left(w ->> 'name', 80), w ->> 'domain', w ->> 'base_url',
          coalesce(w ->> 'country_code', 'US'), coalesce(w ->> 'language_code', 'en'), true, uid)
  returning id into v_site;

  -- Audit + checks
  insert into public.seo_audits (organization_id, website_id, scoring_version, score, score_breakdown,
                                 pages_analyzed, critical_count, warning_count, opportunity_count, passed_count)
  select v_org, v_site, a ->> 'scoring_version', (a ->> 'score')::numeric, coalesce(a -> 'score_breakdown', '{}'),
         (a ->> 'pages_analyzed')::int,
         count(*) filter (where c ->> 'severity' = 'critical'),
         count(*) filter (where c ->> 'severity' = 'warning'),
         count(*) filter (where c ->> 'severity' = 'opportunity'),
         count(*) filter (where c ->> 'severity' = 'passed')
  from jsonb_array_elements(a -> 'checks') c
  returning id into v_audit;

  insert into public.seo_checks (organization_id, audit_id, rule_id, category, severity, result, weight, rule_score,
                                 affected_count, total_count, explanation, recommendation, details)
  select v_org, v_audit, c.rule_id, c.category, c.severity::public.seo_severity, c.result, c.weight, c.rule_score,
         c.affected_count, c.total_count, c.explanation, c.recommendation, '{"demo": true}'::jsonb
  from jsonb_to_recordset(a -> 'checks') as c(rule_id text, category text, severity text, result text, weight numeric,
       rule_score numeric, affected_count int, total_count int, explanation text, recommendation text);

  -- Issues + affected pages
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'issues', '[]')) loop
    insert into public.seo_issues (organization_id, website_id, rule_id, fingerprint, title, explanation, recommendation,
                                   severity, affected_pages_count, last_audit_id)
    values (v_org, v_site, r ->> 'rule_id', r ->> 'rule_id', r ->> 'title', r ->> 'explanation', r ->> 'recommendation',
            (r ->> 'severity')::public.seo_severity, (r ->> 'affected_pages_count')::int, v_audit)
    returning id into v_issue;
    insert into public.seo_issue_pages (issue_id, organization_id, url)
    select v_issue, v_org, u from jsonb_array_elements_text(coalesce(r -> 'urls', '[]')) u limit 50
    on conflict do nothing;
  end loop;

  update public.websites set latest_score = (a ->> 'score')::numeric, last_crawled_at = now() where id = v_site;

  -- Search Console / Analytics (always source = 'demo')
  insert into public.search_console_daily (organization_id, website_id, date, source, clicks, impressions, ctr, position)
  select v_org, v_site, x.date, 'demo', x.clicks, x.impressions, x.ctr, x.position
  from jsonb_to_recordset(coalesce(p_data -> 'gsc_daily', '[]')) as x(date date, clicks int, impressions int, ctr numeric, position numeric);

  insert into public.search_console_queries (organization_id, website_id, date, query, source, clicks, impressions, ctr, position)
  select v_org, v_site, x.date, left(x.query, 300), 'demo', x.clicks, x.impressions, x.ctr, x.position
  from jsonb_to_recordset(coalesce(p_data -> 'gsc_queries', '[]')) as x(date date, query text, clicks int, impressions int, ctr numeric, position numeric)
  on conflict do nothing;

  insert into public.search_console_pages (organization_id, website_id, date, page, source, clicks, impressions, ctr, position)
  select v_org, v_site, x.date, left(x.page, 2048), 'demo', x.clicks, x.impressions, x.ctr, x.position
  from jsonb_to_recordset(coalesce(p_data -> 'gsc_pages', '[]')) as x(date date, page text, clicks int, impressions int, ctr numeric, position numeric)
  on conflict do nothing;

  insert into public.analytics_daily (organization_id, website_id, date, channel, source, users, new_users, sessions,
                                      engaged_sessions, page_views, engagement_rate)
  select v_org, v_site, x.date, left(x.channel, 60), 'demo', x.users, x.new_users, x.sessions, x.engaged_sessions,
         x.page_views, x.engagement_rate
  from jsonb_to_recordset(coalesce(p_data -> 'ga_daily', '[]')) as x(date date, channel text, users int, new_users int,
       sessions int, engaged_sessions int, page_views int, engagement_rate numeric)
  on conflict do nothing;

  -- Tracked keywords + rank snapshots
  for r in select * from jsonb_array_elements(coalesce(p_data -> 'keywords', '[]')) loop
    v_kw := null;
    insert into public.keywords (organization_id, website_id, keyword, normalized_keyword, country_code, language_code,
                                 search_volume, difficulty, metrics_source, metrics_fetched_at, target_url, is_tracked, created_by)
    values (v_org, v_site, left(r ->> 'keyword', 200), lower(left(r ->> 'keyword', 200)),
            coalesce(w ->> 'country_code', 'US'), coalesce(w ->> 'language_code', 'en'),
            (r ->> 'search_volume')::int, (r ->> 'difficulty')::smallint, 'demo', now(), r ->> 'target_url', true, uid)
    on conflict do nothing
    returning id into v_kw;
    if v_kw is not null then
      insert into public.keyword_rankings (organization_id, keyword_id, checked_on, position, ranking_url, source)
      select v_org, v_kw, x.checked_on, x.position, x.ranking_url, 'demo'
      from jsonb_to_recordset(coalesce(r -> 'rankings', '[]')) as x(checked_on date, position smallint, ranking_url text)
      limit 400
      on conflict do nothing;
    end if;
  end loop;

  update public.profiles set last_organization_id = v_org where id = uid;
  insert into public.audit_logs (organization_id, actor_id, action, entity_type, entity_id)
  values (v_org, uid, 'demo_project.created', 'organization', v_org);

  return jsonb_build_object('slug', v_slug, 'website_id', v_site, 'created', true);
end;
$$;

revoke all on function public.create_demo_project(jsonb) from public, anon;
grant execute on function public.create_demo_project(jsonb) to authenticated, service_role;
