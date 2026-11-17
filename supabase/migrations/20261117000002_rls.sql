-- Row level security, grants and policies for every public table.
-- Supabase's default privileges may already have granted anon/authenticated ALL on these tables,
-- so revoke on every existing public table, then grant back only what each role needs. (Future
-- tables are covered by the alter default privileges in the schema migration.) RLS then narrows
-- the rows.

alter table public.profiles enable row level security;
alter table public.recipes enable row level security;
alter table public.folders enable row level security;
alter table public.saves enable row level security;
alter table public.remixes enable row level security;
alter table public.likes enable row level security;
alter table public.challenges enable row level security;
alter table public.usage enable row level security;

-- True when the signed-in user's profile has is_admin. Security definer so policies can call it
-- without recursing through profiles RLS.
create function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  )
$$;

revoke execute on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

revoke execute on function public.set_updated_at() from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
grant all on all tables in schema public to service_role;

-- profiles: own row; admins read all. Rows are created by the sign-up trigger only.
-- Column grants stop users touching is_admin and plan (the guard trigger is a second line).
grant select on public.profiles to authenticated;
grant update (name, avatar_url, diet_prefs) on public.profiles to authenticated;

create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- recipes: everyone reads live shef recipes; admins read and write everything.
grant select on public.recipes to anon, authenticated;
grant insert, update, delete on public.recipes to authenticated;

create policy recipes_select_live_shef on public.recipes
  for select to anon, authenticated
  using ((status = 'live' and source = 'shef') or (select public.is_admin()));

create policy recipes_admin_insert on public.recipes
  for insert to authenticated
  with check ((select public.is_admin()));

create policy recipes_admin_update on public.recipes
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy recipes_admin_delete on public.recipes
  for delete to authenticated
  using ((select public.is_admin()));

-- folders: own rows only.
grant select, insert, update, delete on public.folders to authenticated;

create policy folders_own on public.folders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- saves: own rows, into own folder (or none), of a recipe the user can see.
grant select, insert, update, delete on public.saves to authenticated;

create policy saves_select_own on public.saves
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy saves_insert_own on public.saves
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (folder_id is null or exists (
      select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid())
    ))
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );

create policy saves_update_own on public.saves
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (folder_id is null or exists (
      select 1 from public.folders f where f.id = folder_id and f.user_id = (select auth.uid())
    ))
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );

create policy saves_delete_own on public.saves
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- remixes: own rows; admins read all (moderation). Users cannot set user_id after insert or
-- status at all (moderation goes through the service role).
grant select, delete on public.remixes to authenticated;
grant insert (recipe_id, user_id, challenge_id, photo_path, changes) on public.remixes to authenticated;
grant update (recipe_id, challenge_id, photo_path, changes) on public.remixes to authenticated;

create policy remixes_select_own_or_admin on public.remixes
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy remixes_insert_own on public.remixes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );

create policy remixes_update_own on public.remixes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.recipes r where r.id = recipe_id)
  );

create policy remixes_delete_own on public.remixes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- likes: own rows only, no updates.
grant select, insert, delete on public.likes to authenticated;

create policy likes_select_own on public.likes
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy likes_insert_own on public.likes
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.remixes m where m.id = remix_id)
  );

create policy likes_delete_own on public.likes
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- challenges: anyone reads; admins write.
grant select on public.challenges to anon, authenticated;
grant insert, update, delete on public.challenges to authenticated;

create policy challenges_select_all on public.challenges
  for select to anon, authenticated
  using (true);

create policy challenges_admin_insert on public.challenges
  for insert to authenticated
  with check ((select public.is_admin()));

create policy challenges_admin_update on public.challenges
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy challenges_admin_delete on public.challenges
  for delete to authenticated
  using ((select public.is_admin()));

-- usage: users read their own counters; only the server (service role) writes.
grant select on public.usage to authenticated;

create policy usage_select_own on public.usage
  for select to authenticated
  using (user_id = (select auth.uid()));
