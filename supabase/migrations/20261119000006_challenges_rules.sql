-- Task 3, slice C: weekly challenges.
-- * nz_today() is the NZ calendar date, whatever the session time zone.
-- * One challenge at a time; its base recipe is a live Shef recipe.
-- * The winner is picked only after the end (NZ) and only from approved entries of that challenge.
-- * A remix is entered when, on the NZ day it is posted, it is of the open challenge's base recipe.
-- The existing policies stay: anyone reads challenges, only admins insert, update and delete.

-- Security invoker: it reads nothing, and the remix insert trigger (also invoker) calls it.
create function public.nz_today() returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.now() at time zone 'Pacific/Auckland')::date
$$;

revoke execute on function public.nz_today() from public;
grant execute on function public.nz_today() to anon, authenticated, service_role;

-- not valid: applies to new and changed rows, existing rows are left as they are.
alter table public.challenges add constraint challenges_description_length
  check (description is null or char_length(description) <= 2000) not valid;

-- Runs for every role, the database owner included. Security definer so the checks see every
-- recipe, challenge and remix whatever the caller's RLS. ends_on < starts_on is left to the
-- challenges_dates check (23514), which runs after this trigger.
create function public.challenges_validate() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialises challenge writes so two overlapping challenges cannot be created at once.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('public.challenges_validate'));

  if (tg_op = 'INSERT' or new.base_recipe_id is distinct from old.base_recipe_id)
     -- "on delete set null" from recipes clears it on update; that is allowed
     and not (tg_op = 'UPDATE' and new.base_recipe_id is null)
     and not exists (
       select 1 from public.recipes r
       where r.id = new.base_recipe_id and r.source = 'shef' and r.status = 'live'
     ) then
    raise exception 'challenge base recipe must be a live Shef recipe' using errcode = 'SMC01';
  end if;

  if (tg_op = 'INSERT' or new.starts_on is distinct from old.starts_on or new.ends_on is distinct from old.ends_on)
     and exists (
       select 1 from public.challenges c
       where c.id <> new.id and c.starts_on <= new.ends_on and c.ends_on >= new.starts_on
     ) then
    raise exception 'challenge dates overlap another challenge' using errcode = '23P01';
  end if;

  -- Re-checked when ends_on moves too, so a picked challenge cannot be reopened with its winner.
  if new.winner_remix_id is not null
     and (tg_op = 'INSERT'
          or new.winner_remix_id is distinct from old.winner_remix_id
          or new.ends_on is distinct from old.ends_on) then
    if public.nz_today() <= new.ends_on then
      raise exception 'a winner can be picked only after the challenge ends' using errcode = 'SMC02';
    end if;
    if not exists (
      select 1 from public.remixes m
      where m.id = new.winner_remix_id and m.status = 'approved' and m.challenge_id = new.id
    ) then
      raise exception 'the winner must be an approved entry of this challenge' using errcode = 'SMC03';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.challenges_validate() from public, anon, authenticated;

create trigger challenges_validate before insert or update on public.challenges
  for each row execute function public.challenges_validate();

-- Same as slice A, but the challenge is now chosen here: the open challenge (NZ date) whose base
-- recipe is this remix's recipe, else null. The client can still never send challenge_id.
create or replace function public.remixes_before_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;

  new.status := 'pending';
  new.created_at := now();
  new.updated_at := now();
  new.challenge_id := (
    select c.id from public.challenges c
    where c.base_recipe_id = new.recipe_id
      and public.nz_today() between c.starts_on and c.ends_on
    order by c.starts_on desc
    limit 1
  );

  if new.photo_path is null or not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'remix-photos' and o.name = new.photo_path
  ) then
    raise exception 'remix photo not found' using errcode = '23503';
  end if;

  perform public.consume_usage('remix', public.usage_cap('remix'));
  return new;
end;
$$;

-- remix_feed gains p_remix_id so a challenge's winner is read directly, not searched for in a
-- page of entries. Same rules as slice A: approved remixes of live Shef recipes by users who are
-- not banned, first name only, never user_id, email or moderation data. Dropped and recreated
-- (not overloaded) so there is still exactly one remix_feed; callers use named arguments.
drop function public.remix_feed(uuid, uuid, text, integer, integer);

create function public.remix_feed(
  p_recipe_id uuid default null,
  p_challenge_id uuid default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0,
  p_remix_id uuid default null
) returns table (
  id uuid,
  recipe_id uuid,
  recipe_slug text,
  recipe_title text,
  challenge_id uuid,
  changes text,
  photo_path text,
  author_name text,
  like_count integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_sort is null or p_sort not in ('newest', 'likes') then
    raise exception 'remix_feed: sort must be newest or likes' using errcode = '22023';
  end if;

  return query
  select f.id, f.recipe_id, f.recipe_slug, f.recipe_title, f.challenge_id, f.changes, f.photo_path,
         f.author_name, f.like_count, f.created_at
  from (
    select
      m.id,
      m.recipe_id,
      r.slug as recipe_slug,
      r.title as recipe_title,
      m.challenge_id,
      m.changes,
      m.photo_path,
      -- first word only; a missing name or one that looks like an email address is never shown
      case
        when w.first_word is null or position('@' in w.first_word) > 0 then 'A home cook'
        else left(w.first_word, 40)
      end as author_name,
      (select count(*)::integer from public.likes l where l.remix_id = m.id) as like_count,
      m.created_at
    from public.remixes m
    join public.recipes r on r.id = m.recipe_id
    left join public.profiles p on p.id = m.user_id
    cross join lateral (select substring(p.name from '\S+') as first_word) w
    where m.status = 'approved'
      and r.source = 'shef'
      and r.status = 'live'
      and not exists (select 1 from public.bans b where b.user_id = m.user_id)
      and (p_recipe_id is null or m.recipe_id = p_recipe_id)
      and (p_challenge_id is null or m.challenge_id = p_challenge_id)
      and (p_remix_id is null or m.id = p_remix_id)
  ) f
  order by
    case when p_sort = 'likes' then f.like_count end desc nulls last,
    f.created_at desc,
    f.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 48)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.remix_feed(uuid, uuid, text, integer, integer, uuid) from public;
grant execute on function public.remix_feed(uuid, uuid, text, integer, integer, uuid) to anon, authenticated;
