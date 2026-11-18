-- Task 3, slice A: remix-photos storage rules (storage.objects policies are permissive, so the
-- narrowing rules are restrictive). Other buckets are untouched.
-- * Anyone may read (and so get a signed URL for) a photo of a public remix.
-- * No overwrite or move of a remix photo, so an approved photo cannot be swapped.
-- * No delete while a remix uses the photo.
-- * No upload by banned users, past 20 uploads in 24 hours, or with 5 photos no remix uses.

-- The counting helpers below are security definer and read storage.objects and public.remixes
-- as the migration owner. If that role were subject to RLS on storage.objects, the counts would
-- silently be 0 and the upload limits would never trigger, so refuse to install them at all.
do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles r
    where r.rolname = current_user and (r.rolsuper or r.rolbypassrls)
  ) then
    raise exception 'remix photo rules must be installed by a role that bypasses RLS (current_user %)', current_user
      using errcode = '42501';
  end if;
end;
$$;

create policy shef_remix_photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'remix-photos' and public.remix_photo_is_public(name));

create policy shef_remix_photos_no_update on storage.objects
  as restrictive
  for update to authenticated
  using (true)
  with check (bucket_id <> 'remix-photos');

create policy shef_remix_photos_no_delete_in_use on storage.objects
  as restrictive
  for delete to authenticated
  using (bucket_id <> 'remix-photos' or not public.remix_photo_in_use(name));

-- Both helpers take the same per-user advisory lock (held to the end of the transaction), so
-- parallel uploads by one user are counted one after another. They are volatile so each count
-- takes a fresh snapshot after the lock and sees uploads committed while waiting.
-- Security definer because a storage.objects policy cannot query storage.objects itself
-- without recursing.

-- Uploads to the caller's remix-photos folder in the last 24 hours.
create function public.remix_photo_uploads_recent() returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('remix_uploads'), hashtext(auth.uid()::text));
  return (
    select count(*)::integer
    from storage.objects o
    where o.bucket_id = 'remix-photos'
      and o.name like auth.uid()::text || '/%'
      and o.created_at > now() - interval '24 hours'
  );
end;
$$;

-- Objects in the caller's remix-photos folder that no remix uses, whatever their age.
create function public.remix_photo_unused_count() returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext('remix_uploads'), hashtext(auth.uid()::text));
  return (
    select count(*)::integer
    from storage.objects o
    where o.bucket_id = 'remix-photos'
      and o.name like auth.uid()::text || '/%'
      and not exists (select 1 from public.remixes m where m.photo_path = o.name)
  );
end;
$$;

revoke execute on function public.remix_photo_uploads_recent() from public, anon;
revoke execute on function public.remix_photo_unused_count() from public, anon;
grant execute on function public.remix_photo_uploads_recent() to authenticated;
grant execute on function public.remix_photo_unused_count() to authenticated;

create policy shef_remix_photos_upload_rules on storage.objects
  as restrictive
  for insert to authenticated
  with check (
    bucket_id <> 'remix-photos'
    or (
      not (select public.is_banned())
      and (select public.remix_photo_uploads_recent()) < 20
      and (select public.remix_photo_unused_count()) < 5
    )
  );
