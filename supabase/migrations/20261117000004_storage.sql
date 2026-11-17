-- Storage buckets and object policies.
-- recipe-images: public bucket (files served by public URL, which needs no select policy), admin
-- write. remix-photos: private, each user under "<uid>/...". drafts: private, admins only.
-- Private files are served through signed URLs. All buckets: images only, 5 MB max.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('recipe-images', 'recipe-images', true, 5242880, '{image/jpeg,image/png,image/webp}'),
  ('remix-photos', 'remix-photos', false, 5242880, '{image/jpeg,image/png,image/webp}'),
  ('drafts', 'drafts', false, 5242880, '{image/jpeg,image/png,image/webp}')
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- recipe-images: listing is admin only; anyone can still fetch files by public URL.
create policy shef_recipe_images_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'recipe-images' and (select public.is_admin()))
  with check (bucket_id = 'recipe-images' and (select public.is_admin()));

-- remix-photos: first folder must be the caller's uid (files at the bucket root are rejected).
create policy shef_remix_photos_own on storage.objects
  for all to authenticated
  using (
    bucket_id = 'remix-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'remix-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- remix-photos: admins may read (moderation), not write.
create policy shef_remix_photos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'remix-photos' and (select public.is_admin()));

-- drafts: admins only.
create policy shef_drafts_admin on storage.objects
  for all to authenticated
  using (bucket_id = 'drafts' and (select public.is_admin()))
  with check (bucket_id = 'drafts' and (select public.is_admin()));
