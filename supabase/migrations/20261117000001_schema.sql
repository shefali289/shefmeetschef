-- v1 data model: enums, tables, checks and the updated_at trigger.
-- RLS, grants and policies live in 20261117000002_rls.sql.

-- Supabase's default privileges give anon/authenticated ALL on every new table and EXECUTE on
-- every new function in public. Turn that off for objects this role creates from here on, so
-- each later migration has to grant access explicitly. Note: a schema-scoped default cannot take
-- away the built-in PUBLIC execute on functions, so every function still revokes it explicitly.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

create type public.recipe_source as enum ('shef', 'outside');
create type public.recipe_status as enum ('draft', 'live');
create type public.plan_tier as enum ('free', 'plus');
create type public.usage_kind as enum ('ask', 'remix');

-- Keeps updated_at current on every update.
create function public.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text check (char_length(name) <= 100),
  avatar_url text check (avatar_url ~ '^https://' and char_length(avatar_url) <= 2000),
  diet_prefs text[] not null default '{}' check (cardinality(diet_prefs) <= 20),
  is_admin boolean not null default false,
  plan public.plan_tier not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.recipes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 120),
  title text not null check (char_length(title) between 1 and 200),
  description text,
  reel_url text,
  youtube_url text,
  cover_image_url text,
  source public.recipe_source not null default 'shef',
  owner_id uuid references public.profiles (id) on delete set null,
  ingredients jsonb not null default '[]' check (jsonb_typeof(ingredients) = 'array'),
  steps jsonb not null default '[]' check (jsonb_typeof(steps) = 'array'),
  base_servings integer not null default 2 check (base_servings between 1 and 12),
  prep_minutes integer check (prep_minutes >= 0),
  cook_minutes integer check (cook_minutes >= 0),
  cuisine text,
  diet_tags text[] not null default '{}',
  allergens text[] not null default '{}',
  categories text[] not null default '{}',
  status public.recipe_status not null default 'draft',
  instagram_id text unique,
  youtube_id text unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recipes_live_has_published_at check (status <> 'live' or published_at is not null)
);

create index recipes_status_source_idx on public.recipes (status, source);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index folders_user_id_idx on public.folders (user_id);

create table public.saves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint saves_unique unique nulls not distinct (user_id, recipe_id, folder_id)
);

create index saves_recipe_id_idx on public.saves (recipe_id);
create index saves_folder_id_idx on public.saves (folder_id);

create table public.remixes (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references public.recipes (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- Storage path in remix-photos; must sit in the owner's "<uid>/" folder, never the bucket root.
  photo_path text check (
    photo_path like user_id::text || '/_%' and char_length(photo_path) <= 500
  ),
  changes text check (char_length(changes) <= 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index remixes_recipe_id_idx on public.remixes (recipe_id);
create index remixes_user_id_idx on public.remixes (user_id);

create table public.likes (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  remix_id uuid not null references public.remixes (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, remix_id)
);

create index likes_remix_id_idx on public.likes (remix_id);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  base_recipe_id uuid references public.recipes (id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  starts_on date not null,
  ends_on date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  winner_remix_id uuid references public.remixes (id) on delete set null,
  constraint challenges_dates check (ends_on >= starts_on)
);

-- Added after challenges exists (remixes <-> challenges reference each other).
alter table public.remixes
  add column challenge_id uuid references public.challenges (id) on delete set null;

create index remixes_challenge_id_idx on public.remixes (challenge_id);

-- Free-tier counters, written only by the server (service role).
create table public.usage (
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind public.usage_kind not null,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind, period)
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger recipes_updated_at before update on public.recipes
  for each row execute function public.set_updated_at();
create trigger folders_updated_at before update on public.folders
  for each row execute function public.set_updated_at();
create trigger remixes_updated_at before update on public.remixes
  for each row execute function public.set_updated_at();
create trigger challenges_updated_at before update on public.challenges
  for each row execute function public.set_updated_at();
create trigger usage_updated_at before update on public.usage
  for each row execute function public.set_updated_at();
