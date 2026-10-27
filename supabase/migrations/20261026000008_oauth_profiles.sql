-- =============================================================================
-- Rankora — 0008 Social sign-in profiles
-- Google and GitHub put the display name in `full_name` or `name` (GitHub may
-- only provide `user_name`) and the photo in `avatar_url` / `picture`.
-- =============================================================================

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  display_name text := nullif(left(trim(coalesce(meta ->> 'full_name', meta ->> 'name', meta ->> 'user_name', '')), 120), '');
  avatar text := nullif(coalesce(meta ->> 'avatar_url', meta ->> 'picture', ''), '');
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    display_name,
    case when avatar ~ '^https://' and char_length(avatar) <= 2048 then avatar end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
