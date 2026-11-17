-- import_skips: Instagram / YouTube posts the importer should not send to Gemini again
-- (caption had no recipe, or parsing failed). Admin only.

create table public.import_skips (
  source text not null check (source in ('instagram', 'youtube')),
  external_id text not null check (char_length(external_id) between 1 and 200),
  reason text not null check (reason in ('no_recipe', 'failed')),
  created_at timestamptz not null default now(),
  primary key (source, external_id)
);

alter table public.import_skips enable row level security;

revoke all on public.import_skips from anon, authenticated;
grant all on public.import_skips to service_role;
grant select, insert, delete on public.import_skips to authenticated;

create policy import_skips_admin_select on public.import_skips
  for select to authenticated
  using ((select public.is_admin()));

create policy import_skips_admin_insert on public.import_skips
  for insert to authenticated
  with check ((select public.is_admin()));

create policy import_skips_admin_delete on public.import_skips
  for delete to authenticated
  using ((select public.is_admin()));
