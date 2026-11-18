-- Task 2: free-tier usage counters, counted atomically in Postgres.
-- Ask Shef is counted per NZ day ('YYYY-MM-DD'); every other kind per NZ month ('YYYY-MM').
-- Users never write usage rows directly: they call consume_usage, which only spends their own
-- quota (auth.uid()), and read what is left with usage_remaining.

alter table public.usage drop constraint usage_period_check;
alter table public.usage add constraint usage_period_check check (
  period ~ '^\d{4}-(0[1-9]|1[0-2])$'
  or period ~ '^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
);

-- The period a use at `at` falls in, in New Zealand time (independent of the session time zone).
create function public.usage_period(kind public.usage_kind, at timestamptz) returns text
language sql
stable
set search_path = ''
as $$
  select to_char(
    usage_period.at at time zone 'Pacific/Auckland',
    case when usage_period.kind = 'ask' then 'YYYY-MM-DD' else 'YYYY-MM' end
  )
$$;

revoke execute on function public.usage_period(public.usage_kind, timestamptz) from public, anon;
grant execute on function public.usage_period(public.usage_kind, timestamptz) to authenticated, service_role;

-- Spends one use of `kind` for the signed-in user in the current period and returns how many are
-- left. One upsert guarded by count < lim, so parallel calls can never go past the limit.
-- Raises SQLSTATE SMU01 'usage_limit_reached' when the allowance is used up.
create function public.consume_usage(kind public.usage_kind, lim integer) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception 'consume_usage: not signed in' using errcode = '28000';
  end if;
  if lim is null or lim < 1 then
    raise exception 'consume_usage: limit must be at least 1' using errcode = '22023';
  end if;

  insert into public.usage as u (user_id, kind, period, count)
  values (uid, consume_usage.kind, public.usage_period(consume_usage.kind, now()), 1)
  on conflict on constraint usage_pkey
    do update set count = u.count + 1
    where u.count < consume_usage.lim
  returning u.count into used;

  if used is null then
    raise exception 'usage_limit_reached' using errcode = 'SMU01';
  end if;
  return consume_usage.lim - used;
end;
$$;

-- How many uses of `kind` the signed-in user has left this period (never below 0). Read-only.
create function public.usage_remaining(kind public.usage_kind, lim integer) returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  used integer;
begin
  if uid is null then
    raise exception 'usage_remaining: not signed in' using errcode = '28000';
  end if;
  if lim is null or lim < 1 then
    raise exception 'usage_remaining: limit must be at least 1' using errcode = '22023';
  end if;

  select u.count into used from public.usage u
  where u.user_id = uid
    and u.kind = usage_remaining.kind
    and u.period = public.usage_period(usage_remaining.kind, now());

  return greatest(usage_remaining.lim - coalesce(used, 0), 0);
end;
$$;

revoke execute on function public.consume_usage(public.usage_kind, integer) from public, anon;
revoke execute on function public.usage_remaining(public.usage_kind, integer) from public, anon;
grant execute on function public.consume_usage(public.usage_kind, integer) to authenticated;
grant execute on function public.usage_remaining(public.usage_kind, integer) to authenticated;
