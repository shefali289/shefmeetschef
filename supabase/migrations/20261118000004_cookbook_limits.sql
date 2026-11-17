-- Task 2: cookbook rules.
-- * One save per recipe per user (in at most one folder). Older duplicates are merged first,
--   keeping the oldest save.
-- * Deleting a folder keeps its saves, unfiled.
-- * At most saves_limit(uid) saves of non-outside recipes per user, enforced by a trigger.

delete from public.saves s
using public.saves o
where o.user_id = s.user_id
  and o.recipe_id = s.recipe_id
  and (o.created_at, o.id) < (s.created_at, s.id);

alter table public.saves drop constraint saves_unique;
alter table public.saves add constraint saves_user_recipe_unique unique (user_id, recipe_id);

alter table public.saves drop constraint saves_folder_id_fkey;
alter table public.saves add constraint saves_folder_id_fkey
  foreign key (folder_id) references public.folders (id) on delete set null;

-- How many (non-outside) saves a user may keep. One place so a paid plan can lift it later.
create function public.saves_limit(uid uuid) returns integer
language sql
stable
set search_path = ''
as $$
  select 30
$$;

revoke execute on function public.saves_limit(uuid) from public, anon;
grant execute on function public.saves_limit(uuid) to authenticated, service_role;

-- Raises SQLSTATE SMS01 'saves_limit_reached' when a new (or repointed) save of a non-outside
-- recipe would take the user past saves_limit. A per-user advisory lock serialises concurrent
-- saves so two requests cannot both pass the count.
create function public.saves_enforce_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  used integer;
begin
  if tg_op = 'UPDATE' and new.recipe_id = old.recipe_id and new.user_id = old.user_id then
    return new;
  end if;
  if exists (select 1 from public.recipes r where r.id = new.recipe_id and r.source = 'outside') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext(new.user_id::text));

  select count(*) into used
  from public.saves s
  join public.recipes r on r.id = s.recipe_id
  where s.user_id = new.user_id
    and r.source <> 'outside'
    and s.id <> new.id;

  if used >= public.saves_limit(new.user_id) then
    raise exception 'saves_limit_reached' using errcode = 'SMS01';
  end if;
  return new;
end;
$$;

revoke execute on function public.saves_enforce_limit() from public, anon, authenticated;

create trigger saves_enforce_limit before insert or update of recipe_id, user_id on public.saves
  for each row execute function public.saves_enforce_limit();
