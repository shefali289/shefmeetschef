-- Task 3, slice A: remixes are counted per NZ day (like Ask Shef) with a free cap of 5.
-- Same signatures as before, so the existing grants stay in place.

create or replace function public.usage_period(kind public.usage_kind, at timestamptz) returns text
language sql
stable
set search_path = ''
as $$
  select to_char(
    usage_period.at at time zone 'Pacific/Auckland',
    case when usage_period.kind in ('ask', 'remix') then 'YYYY-MM-DD' else 'YYYY-MM' end
  )
$$;

create or replace function public.usage_cap(kind public.usage_kind) returns integer
language sql
immutable
set search_path = ''
as $$
  select case usage_cap.kind::text
    when 'ask' then 10
    when 'remix' then 5
    when 'outside_reel' then 5
    else null
  end
$$;
