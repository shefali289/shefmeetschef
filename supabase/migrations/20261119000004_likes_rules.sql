-- Task 3, slice A: likes only on public (approved) remixes, never by banned users.
-- Deleting your own like is unchanged.

drop policy likes_insert_own on public.likes;
create policy likes_insert_own on public.likes
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.remix_is_public(remix_id));

create policy likes_insert_not_banned on public.likes
  as restrictive
  for insert to authenticated
  with check (not (select public.is_banned()));
