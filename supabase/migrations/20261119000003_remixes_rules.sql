-- Task 3, slice A: posting rules for remixes and the public read model.
-- * A remix needs a photo and 1 to 2000 characters of "what I changed"; each photo is used once.
-- * Nobody updates remixes from the API (status moves only through functions, slice D).
-- * Users remix only live Shef recipes, never while banned, with a photo they uploaded.
-- * The insert trigger forces pending / now() / no challenge and spends the daily remix usage.
-- * Public reads go through remix_feed; the remixes table stays own-row or admin.

-- not valid: applies to new and changed rows, existing rows are left as they are.
-- The trim set is ASCII whitespace plus no-break space (U+00A0), zero-width space (U+200B) and
-- the byte order mark (U+FEFF), so text made only of invisible characters counts as blank.
alter table public.remixes add constraint remixes_complete check (
  photo_path is not null
  and changes is not null
  and char_length(btrim(changes, E' \t\r\n\f\x0B\u00A0\u200B\uFEFF')) between 1 and 2000
) not valid;

create unique index remixes_photo_path_key on public.remixes (photo_path);

-- No editing after posting, for users and admins alike. Revoking the table privilege also
-- revokes the column grants from the task 1 migration.
revoke update on public.remixes from authenticated;
drop policy remixes_update_own on public.remixes;

-- The challenge is chosen by the database (slice C), never by the client.
revoke insert (challenge_id) on public.remixes from authenticated;

drop policy remixes_insert_own on public.remixes;
create policy remixes_insert_own on public.remixes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.recipes r
      where r.id = recipe_id and r.source = 'shef' and r.status = 'live'
    )
  );

create policy remixes_insert_not_banned on public.remixes
  as restrictive
  for insert to authenticated
  with check (not (select public.is_banned()));

-- Security invoker on purpose: current_user is the API role, and the photo lookup only sees
-- objects the caller can see (storage RLS). Runs before RLS checks and constraints; if any of
-- them fails the whole statement rolls back, including the usage spent here. Superuser and
-- service_role writes (seeding, moderation) are left alone.
create function public.remixes_before_insert() returns trigger
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
  -- Cleared here so the client can never choose it. Triggers of the same kind fire in name
  -- order, so slice C must either set the open challenge inside this function or give its
  -- trigger a name that sorts after remixes_before_insert (e.g. remixes_set_challenge);
  -- otherwise this line wipes what it sets.
  new.challenge_id := null;

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

revoke execute on function public.remixes_before_insert() from public, anon, authenticated;

create trigger remixes_before_insert before insert on public.remixes
  for each row execute function public.remixes_before_insert();

-- True when the remix is approved, of a live Shef recipe, by a user who is not banned.
create function public.remix_is_public(p_remix_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.remixes m
    join public.recipes r on r.id = m.recipe_id
    where m.id = p_remix_id
      and m.status = 'approved'
      and r.source = 'shef'
      and r.status = 'live'
      and not exists (select 1 from public.bans b where b.user_id = m.user_id)
  )
$$;

-- True when a remix-photos object name belongs to a public remix (storage read rule).
create function public.remix_photo_is_public(p_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.remixes m
    where m.photo_path = p_name and public.remix_is_public(m.id)
  )
$$;

-- True when any remix points at this remix-photos object name (storage delete rule).
-- Signed-in users get the real answer only for paths in their own folder (admins for any path),
-- so nobody can probe whether another user's photo is in use. Callers that are not API roles
-- (database owner, migrations, service jobs) see the real answer. The `role` setting keeps the
-- caller's SET ROLE inside this security definer function, unlike current_user.
create function public.remix_photo_in_use(p_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.remixes m where m.photo_path = p_name)
    and (
      current_setting('role') not in ('anon', 'authenticated')
      or p_name like auth.uid()::text || '/%'
      or public.is_admin()
    )
$$;

revoke execute on function public.remix_is_public(uuid) from public, anon;
revoke execute on function public.remix_photo_is_public(text) from public;
revoke execute on function public.remix_photo_in_use(text) from public, anon;
grant execute on function public.remix_is_public(uuid) to authenticated;
grant execute on function public.remix_photo_is_public(text) to anon, authenticated;
grant execute on function public.remix_photo_in_use(text) to authenticated;

-- Public remixes, newest first or by likes. Null filters mean "any"; limit is clamped to 1..48.
-- Gives the author's first name only (max 40 characters), never user_id, email or moderation data.
create function public.remix_feed(
  p_recipe_id uuid default null,
  p_challenge_id uuid default null,
  p_sort text default 'newest',
  p_limit integer default 24,
  p_offset integer default 0
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
  ) f
  order by
    case when p_sort = 'likes' then f.like_count end desc nulls last,
    f.created_at desc,
    f.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 48)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke execute on function public.remix_feed(uuid, uuid, text, integer, integer) from public;
grant execute on function public.remix_feed(uuid, uuid, text, integer, integer) to anon, authenticated;
