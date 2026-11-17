-- Task 2, review fixes on slice A (append-only).
-- B1a: a user inserting outside recipes straight through the API cannot make more than their
--      'outside_reel' usage for this NZ month allows (each insert needs a prior consume_usage).
-- B1b: outside reel_url written through the API must be an Instagram reel / post / tv link.
-- B1c: size caps on outside recipe fields (Shef's own recipes are trusted and imported).
-- B2:  'reel-' slugs belong to outside recipes, and only to them.
-- N1/N3: saves limit: re-saving reports the duplicate, and only the user's own outside
--      recipes are exempt.

-- B2. Any Shef recipe that already sits in the reel- space moves to shef-reel-...
update public.recipes
set slug = regexp_replace(left('shef-' || slug, 120), '-+$', '')
where source <> 'outside' and slug like 'reel-%';

-- A check constraint (not a policy) so it holds for every writer, and so a user trying an
-- existing slug gets this error before the unique index can reveal that the slug is taken.
alter table public.recipes add constraint recipes_reel_slug_is_outside
  check ((source = 'outside') = (slug like 'reel-%'));

-- B1c. Title is already capped at 200 for every recipe.
alter table public.recipes add constraint recipes_outside_sizes check (
  source <> 'outside'
  or (
    (description is null or char_length(description) <= 2000)
    and jsonb_array_length(ingredients) <= 60
    and jsonb_array_length(steps) <= 40
    and cardinality(diet_tags) <= 20
    and cardinality(allergens) <= 20
    and cardinality(categories) <= 20
    and (cuisine is null or char_length(cuisine) <= 40)
  )
);

-- B1a and B1b. Runs as the caller (security invoker) so current_user is the API role. It only reads
-- what that role can already see: the caller's own outside recipes and usage rows (RLS). An
-- insert owned by someone else finds no usage and is refused here (RLS would refuse it too).
-- Superuser and service_role writes (seeding, migrations) are not limited.
create function public.recipes_outside_quota() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  month_start timestamptz;
  made integer;
  allowed integer;
begin
  if new.source <> 'outside' or current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  -- B1b. The app rebuilds reel links from parsed ids; this is the database's own allow-list.
  if new.reel_url is null or new.reel_url !~
    '^https://(www\.)?instagram\.com/([A-Za-z0-9._]{1,30}/)?(reel|p|tv)/[A-Za-z0-9_-]+/?$' then
    raise exception 'outside recipe reel_url must be an Instagram reel link' using errcode = '23514';
  end if;

  if tg_op <> 'INSERT' then
    return new;
  end if;

  -- the client cannot backdate the row out of this month's count
  new.created_at := now();

  -- serialise this user's outside inserts so parallel requests cannot both pass the count
  perform pg_advisory_xact_lock(hashtext('recipes_outside_quota'), hashtext(coalesce(new.owner_id::text, '')));

  month_start := date_trunc('month', now() at time zone 'Pacific/Auckland') at time zone 'Pacific/Auckland';

  select count(*) into made
  from public.recipes r
  where r.owner_id = new.owner_id
    and r.source = 'outside'
    and r.created_at >= month_start;

  select coalesce(max(u.count), 0) into allowed
  from public.usage u
  where u.user_id = new.owner_id
    and u.kind = 'outside_reel'
    and u.period = public.usage_period('outside_reel', now());

  if made + 1 > allowed then
    raise exception 'outside_reel_not_consumed' using errcode = 'SMU02';
  end if;
  return new;
end;
$$;

revoke execute on function public.recipes_outside_quota() from public, anon, authenticated;

create trigger recipes_outside_quota before insert or update on public.recipes
  for each row execute function public.recipes_outside_quota();

-- N1/N3. Same trigger on saves, new body.
create or replace function public.saves_enforce_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if tg_op = 'UPDATE' and new.recipe_id = old.recipe_id and new.user_id = old.user_id then
    return new;
  end if;
  -- already saved: let the unique key report the duplicate (23505), not the limit
  if tg_op = 'INSERT' and exists (
    select 1 from public.saves s where s.user_id = new.user_id and s.recipe_id = new.recipe_id
  ) then
    return new;
  end if;
  -- only the user's own outside recipes are free
  if exists (
    select 1 from public.recipes r
    where r.id = new.recipe_id and r.source = 'outside' and r.owner_id = new.user_id
  ) then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('saves_enforce_limit'), hashtext(new.user_id::text));

  select count(*) into used
  from public.saves s
  join public.recipes r on r.id = s.recipe_id
  where s.user_id = new.user_id
    and s.id <> new.id
    and not (r.source = 'outside' and r.owner_id = s.user_id);

  if used >= public.saves_limit(new.user_id) then
    raise exception 'saves_limit_reached' using errcode = 'SMS01';
  end if;
  return new;
end;
$$;

revoke execute on function public.saves_enforce_limit() from public, anon, authenticated;
