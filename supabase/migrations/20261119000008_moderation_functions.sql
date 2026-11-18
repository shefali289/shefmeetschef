-- Task 3, slice D: the only ways a remix's status changes (besides the report trigger).
-- * apply_ai_verdict: the server's AI check, executable by service_role only.
-- * admin_moderate_remix, admin_ban_user, admin_unban_user: for signed-in admins (is_admin()).
-- All security definer with search_path = '' and no PUBLIC or anon execute. Supabase grants
-- execute on new functions to anon and authenticated by default, so those are revoked too.

-- Acts once, on a pending remix that has not been checked. Returns the status after the call, or
-- null when it did nothing. Never approves a banned user's remix (it stays pending for the admin).
create function public.apply_ai_verdict(p_remix_id uuid, p_verdict text, p_reason text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  if p_verdict is null or p_verdict not in ('approve', 'review', 'reject') then
    raise exception 'apply_ai_verdict: verdict must be approve, review or reject' using errcode = '22023';
  end if;

  update public.remixes m
  set ai_verdict = p_verdict,
      ai_reason = left(p_reason, 300),
      ai_checked_at = now(),
      status = case
        when p_verdict = 'reject' then 'hidden'
        when p_verdict = 'approve' and not exists (select 1 from public.bans b where b.user_id = m.user_id) then 'approved'
        else 'pending'
      end,
      hidden_by = case when p_verdict = 'reject' then 'ai' else null end
  where m.id = p_remix_id and m.status = 'pending' and m.ai_checked_at is null
  returning m.status into v_status;

  return v_status;
end;
$$;

revoke execute on function public.apply_ai_verdict(uuid, text, text) from public, anon, authenticated;
grant execute on function public.apply_ai_verdict(uuid, text, text) to service_role;

-- approve: live again, and only reports made after now count toward the next three.
-- hide: hidden by the admin. A banned user's remix cannot be approved (SMM02).
-- An id with no remix raises P0002 (checked after is_admin, so non-admins cannot probe ids).
create function public.admin_moderate_remix(p_remix_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_action is null or p_action not in ('approve', 'hide') then
    raise exception 'admin_moderate_remix: action must be approve or hide' using errcode = '22023';
  end if;

  if p_action = 'approve' then
    if exists (
      select 1 from public.remixes m join public.bans b on b.user_id = m.user_id where m.id = p_remix_id
    ) then
      raise exception 'the author of this remix is banned' using errcode = 'SMM02';
    end if;
    update public.remixes
    set status = 'approved', hidden_by = null, reports_cleared_at = now(), moderated_at = now()
    where id = p_remix_id;
  else
    update public.remixes
    set status = 'hidden', hidden_by = 'admin', moderated_at = now()
    where id = p_remix_id;
  end if;
  if not found then
    raise exception 'admin_moderate_remix: remix not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Records the ban, hides their remixes and removes their likes. Refuses the caller and admins.
create function public.admin_ban_user(p_user_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() or exists (select 1 from public.profiles p where p.id = p_user_id and p.is_admin) then
    raise exception 'admins cannot be banned' using errcode = 'SMM01';
  end if;

  insert into public.bans (user_id, reason, banned_by)
  values (p_user_id, p_reason, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, banned_by = excluded.banned_by;

  update public.remixes
  set status = 'hidden', hidden_by = 'ban', moderated_at = now()
  where user_id = p_user_id and status <> 'hidden';

  delete from public.likes where user_id = p_user_id;
end;
$$;

-- Lifts the ban. Their hidden remixes stay hidden.
create function public.admin_unban_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admins only' using errcode = '42501';
  end if;
  delete from public.bans where user_id = p_user_id;
end;
$$;

revoke execute on function public.admin_moderate_remix(uuid, text) from public, anon;
revoke execute on function public.admin_ban_user(uuid, text) from public, anon;
revoke execute on function public.admin_unban_user(uuid) from public, anon;
grant execute on function public.admin_moderate_remix(uuid, text) to authenticated;
grant execute on function public.admin_ban_user(uuid, text) to authenticated;
grant execute on function public.admin_unban_user(uuid) to authenticated;
