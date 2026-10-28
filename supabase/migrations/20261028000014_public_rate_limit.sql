-- Rate limiting for public (signed-out) endpoints such as the contact form.
-- public.rate_limit_hit() keys buckets by auth.uid() and refuses anonymous callers,
-- so the server calls this keyed variant with the service role and a hashed client key
-- (never a raw IP address). It is not executable by anon or authenticated users.

create or replace function public.rate_limit_hit_key(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  win timestamptz;
  current_hits integer;
begin
  if p_key !~ '^[a-z0-9_:.-]{1,128}$' or p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit arguments';
  end if;
  win := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into private.rate_limits as rl (key, window_start, hits)
  values ('public:' || p_key, win, 1)
  on conflict (key, window_start) do update set hits = rl.hits + 1
  returning hits into current_hits;

  return current_hits <= p_limit;
end;
$$;

revoke all on function public.rate_limit_hit_key(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit_key(text, integer, integer) to service_role;
