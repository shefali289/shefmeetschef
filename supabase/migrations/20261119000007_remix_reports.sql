-- Task 3, slice D: moderation columns on remixes and reports.
-- * The moderation columns are written only by the security definer functions (20261119000008)
--   and the report trigger below. Users have no update privilege on remixes (slice A) and no
--   insert grant on these columns.
-- * Signed-in users report a public remix that is not their own, once, with an optional reason.
--   Banned users cannot report. Reporters read their own reports; admins read all.
-- * Three reports from different users since the admin last approved it hide the remix.
--   Reports by users who are banned now do not count.

alter table public.remixes
  add column ai_verdict text check (ai_verdict in ('approve', 'review', 'reject')),
  add column ai_reason text check (char_length(ai_reason) <= 300),
  add column ai_checked_at timestamptz,
  add column hidden_by text check (hidden_by in ('ai', 'reports', 'admin', 'ban')),
  add column reports_cleared_at timestamptz,
  add column moderated_at timestamptz;

create table public.remix_reports (
  remix_id uuid not null references public.remixes (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  reason text check (char_length(reason) <= 300),
  created_at timestamptz not null default now(),
  primary key (remix_id, user_id)
);

create index remix_reports_user_id_idx on public.remix_reports (user_id);

alter table public.remix_reports enable row level security;

-- Only remix_id and reason come from the client: user_id defaults to auth.uid() and created_at
-- to now(). No update or delete for anyone through the API.
revoke all on public.remix_reports from anon, authenticated;
grant select on public.remix_reports to authenticated;
grant insert (remix_id, reason) on public.remix_reports to authenticated;
grant all on public.remix_reports to service_role;

create policy remix_reports_select_own_or_admin on public.remix_reports
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- remix_is_public is security definer, so the author check reads the remix whatever the
-- reporter's RLS; the second exists only matches the reporter's own remixes.
create policy remix_reports_insert_own on public.remix_reports
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.remix_is_public(remix_id)
    and not exists (select 1 from public.remixes m where m.id = remix_id and m.user_id = (select auth.uid()))
  );

create policy remix_reports_insert_not_banned on public.remix_reports
  as restrictive
  for insert to authenticated
  with check (not (select public.is_banned()));

-- Locks the remix so parallel reports are counted one after another, then hides it once three
-- different users who are not banned reported it since the admin last approved it (all reports
-- when never).
-- The lock is FOR NO KEY UPDATE, not FOR UPDATE: each report insert already holds FOR KEY SHARE
-- on the remix (the foreign key check). FOR UPDATE conflicts with KEY SHARE, so two concurrent
-- reports would each wait for the other's key-share lock and deadlock. FOR NO KEY UPDATE does not
-- conflict with KEY SHARE but still conflicts with itself, so the counts still run one at a time,
-- and the update below changes no key columns.
create function public.remix_reports_after_insert() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cleared timestamptz;
begin
  select m.reports_cleared_at into v_cleared
  from public.remixes m
  where m.id = new.remix_id and m.status = 'approved'
  for no key update;
  if not found then
    return null;
  end if;

  if (
    select count(distinct r.user_id)
    from public.remix_reports r
    where r.remix_id = new.remix_id
      and (v_cleared is null or r.created_at > v_cleared)
      and not exists (select 1 from public.bans b where b.user_id = r.user_id)
  ) >= 3 then
    update public.remixes
    set status = 'hidden', hidden_by = 'reports'
    where id = new.remix_id;
  end if;
  return null;
end;
$$;

revoke execute on function public.remix_reports_after_insert() from public, anon, authenticated;

create trigger remix_reports_after_insert after insert on public.remix_reports
  for each row execute function public.remix_reports_after_insert();
