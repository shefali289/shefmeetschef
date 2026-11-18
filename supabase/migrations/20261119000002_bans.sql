-- Task 3, slice A: banned users cannot post, like, report or upload remix photos.
-- Users read only their own ban; admins read all. Nobody writes bans through the API yet
-- (slice D adds the admin functions).

create table public.bans (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  reason text check (char_length(reason) <= 500),
  banned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.bans enable row level security;

revoke all on public.bans from anon, authenticated;
grant all on public.bans to service_role;
grant select on public.bans to authenticated;

create policy bans_select_own_or_admin on public.bans
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- True when the signed-in caller is banned. Takes no user id, so callers only learn about
-- themselves. Security definer so policies can call it without reading bans through RLS.
create function public.is_banned() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.bans b where b.user_id = auth.uid())
$$;

revoke execute on function public.is_banned() from public, anon;
grant execute on function public.is_banned() to authenticated;
