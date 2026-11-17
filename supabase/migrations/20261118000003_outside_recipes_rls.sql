-- Task 2: outside recipes (made from someone else's Instagram reel) are private to their owner.
-- The owner reads, creates and deletes their own; nobody but admins sees anyone else's. Users
-- cannot update them (no policy), and the existing live-shef / admin policies are unchanged.
-- Deleting one does not give the reel back (usage is counted separately).

create policy recipes_select_own_outside on public.recipes
  for select to authenticated
  using (source = 'outside' and owner_id = (select auth.uid()));

create policy recipes_insert_own_outside on public.recipes
  for insert to authenticated
  with check (
    source = 'outside'
    and status = 'live'
    and owner_id = (select auth.uid())
    and instagram_id is null
    and youtube_id is null
    and youtube_url is null
    and cover_image_url is null
  );

create policy recipes_delete_own_outside on public.recipes
  for delete to authenticated
  using (source = 'outside' and owner_id = (select auth.uid()));
