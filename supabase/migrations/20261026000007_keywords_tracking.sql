-- =============================================================================
-- Rankora — 0007 Keywords & rank tracking
--  * denormalized current / previous / best position on keywords, maintained by
--    a trigger from keyword_rankings (the source of truth for history)
--  * provider metrics and positions are NOT client-writable (column grants):
--    they can only come from a provider call made by the server
--  * per-keyword claim column so concurrent rank-check workers never pay twice
-- =============================================================================

alter table public.keywords
  add column current_position smallint check (current_position between 1 and 200),
  add column previous_position smallint check (previous_position between 1 and 200),
  add column best_position smallint check (best_position between 1 and 200),
  add column current_url text,
  add column last_checked_on date,
  add column rank_source text,
  add column rank_check_claimed_at timestamptz,
  add column search_volume_trend jsonb;

create index keywords_website_check_idx on public.keywords (website_id, last_checked_on) where is_tracked;

create or replace function private.refresh_keyword_position(p_keyword uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.keywords k
  set current_position  = latest.position,
      current_url       = latest.ranking_url,
      last_checked_on   = latest.checked_on,
      rank_source       = latest.source,
      previous_position = prev.position,
      best_position     = best.position
  from
    (select position, ranking_url, checked_on, source from public.keyword_rankings
      where keyword_id = p_keyword order by checked_on desc limit 1) latest
    left join lateral (
      select position from public.keyword_rankings
      where keyword_id = p_keyword and checked_on < latest.checked_on
      order by checked_on desc limit 1) prev on true
    left join lateral (
      select min(position) as position from public.keyword_rankings
      where keyword_id = p_keyword and position is not null) best on true
  where k.id = p_keyword;
$$;

create or replace function private.on_keyword_ranking_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_keyword_position(coalesce(new.keyword_id, old.keyword_id));
  return null;
end;
$$;

create trigger keyword_rankings_refresh
  after insert or update or delete on public.keyword_rankings
  for each row execute function private.on_keyword_ranking_change();

-- backfill existing rows (e.g. Demo Project)
select private.refresh_keyword_position(id) from public.keywords;

-- ---------------------------------------------------------------------------
-- Column-level privileges: clients may manage WHICH keywords they track, never
-- the provider data attached to them.
-- ---------------------------------------------------------------------------
revoke insert, update on public.keywords from authenticated;
grant insert (organization_id, website_id, keyword, normalized_keyword, country_code, language_code,
              device, search_engine, target_url, is_tracked, notes, created_by)
  on public.keywords to authenticated;
grant update (target_url, is_tracked, notes) on public.keywords to authenticated;

-- Demo keywords stay read-only for clients.
drop policy keywords_write on public.keywords;
create policy keywords_insert on public.keywords for insert to authenticated
  with check (
    (select private.has_org_role(organization_id, 'member'))
    and not exists (select 1 from public.websites w where w.id = website_id and w.is_demo)
  );
drop policy keywords_update on public.keywords;
create policy keywords_update on public.keywords for update to authenticated
  using ((select private.has_org_role(organization_id, 'member'))
         and not exists (select 1 from public.websites w where w.id = website_id and w.is_demo))
  with check ((select private.has_org_role(organization_id, 'member')));
drop policy keywords_delete on public.keywords;
create policy keywords_delete on public.keywords for delete to authenticated
  using ((select private.has_org_role(organization_id, 'member'))
         and not exists (select 1 from public.websites w where w.id = website_id and w.is_demo));

-- research cache lookups by org + time window
create index keyword_research_org_time_idx on public.keyword_research_queries (organization_id, created_at desc);
