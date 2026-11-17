-- Creates a profile when a user signs up, and guards is_admin / plan against self-promotion.

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, name, avatar_url)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 100),
    case
      when new.raw_user_meta_data ->> 'avatar_url' ~ '^https://'
        and char_length(new.raw_user_meta_data ->> 'avatar_url') <= 2000
      then new.raw_user_meta_data ->> 'avatar_url'
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Security invoker on purpose: current_user is the caller's role. API callers (anon,
-- authenticated) may not change is_admin or plan unless they are admins; the service role and
-- database owners (migrations, SQL editor) may.
create function public.guard_profile_privileges() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.is_admin is distinct from old.is_admin or new.plan is distinct from old.plan)
     and current_user in ('anon', 'authenticated')
     and not public.is_admin() then
    raise exception 'not allowed to change is_admin or plan'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.guard_profile_privileges() from public, anon, authenticated;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();
