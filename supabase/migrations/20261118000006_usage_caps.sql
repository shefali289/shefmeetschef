-- Task 2 review: consume_usage and usage_remaining are callable straight from the browser
-- (supabase.rpc), so the caller's `lim` cannot be trusted on its own. The effective limit is
-- least(lim, free cap): 10 Ask Shef questions a NZ day, 5 outside reels a NZ month. A smaller lim
-- from the caller still applies. Same signatures, so existing grants stay in place.

-- The free cap for a kind, or null when the kind has no cap yet.
create function public.usage_cap(kind public.usage_kind) returns integer
language sql
immutable
set search_path = ''
as $$
  select case usage_cap.kind::text
    when 'ask' then 10
    when 'outside_reel' then 5
    -- TODO(task 3): cap 'remix' once its free limit is decided; until then lim is used as passed.
    else null
  end
$$;

revoke execute on function public.usage_cap(public.usage_kind) from public, anon;
grant execute on function public.usage_cap(public.usage_kind) to authenticated, service_role;

create or replace function public.consume_usage(kind public.usage_kind, lim integer) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  eff integer;
  used integer;
begin
  if uid is null then
    raise exception 'consume_usage: not signed in' using errcode = '28000';
  end if;
  if lim is null or lim < 1 then
    raise exception 'consume_usage: limit must be at least 1' using errcode = '22023';
  end if;
  eff := least(consume_usage.lim, coalesce(public.usage_cap(consume_usage.kind), consume_usage.lim));

  insert into public.usage as u (user_id, kind, period, count)
  values (uid, consume_usage.kind, public.usage_period(consume_usage.kind, now()), 1)
  on conflict on constraint usage_pkey
    do update set count = u.count + 1
    where u.count < eff
  returning u.count into used;

  if used is null then
    raise exception 'usage_limit_reached' using errcode = 'SMU01';
  end if;
  return eff - used;
end;
$$;

create or replace function public.usage_remaining(kind public.usage_kind, lim integer) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  eff integer;
  used integer;
begin
  if uid is null then
    raise exception 'usage_remaining: not signed in' using errcode = '28000';
  end if;
  if lim is null or lim < 1 then
    raise exception 'usage_remaining: limit must be at least 1' using errcode = '22023';
  end if;
  eff := least(usage_remaining.lim, coalesce(public.usage_cap(usage_remaining.kind), usage_remaining.lim));

  select u.count into used from public.usage u
  where u.user_id = uid
    and u.kind = usage_remaining.kind
    and u.period = public.usage_period(usage_remaining.kind, now());

  return greatest(eff - coalesce(used, 0), 0);
end;
$$;

revoke execute on function public.consume_usage(public.usage_kind, integer) from public, anon;
revoke execute on function public.usage_remaining(public.usage_kind, integer) from public, anon;
grant execute on function public.consume_usage(public.usage_kind, integer) to authenticated;
grant execute on function public.usage_remaining(public.usage_kind, integer) to authenticated;
