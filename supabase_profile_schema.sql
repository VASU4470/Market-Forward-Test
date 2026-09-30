-- PiZero account profile foundation.
-- Run this once in Supabase SQL Editor before enabling the new profile flow.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(username)) stored,
  display_name text not null,
  ranking_opt_in boolean not null default false,
  preferred_language text not null default 'en',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  constraint profiles_username_unique unique (username_normalized)
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

create or replace function public.touch_profile_updated_at()
returns trigger language plpgsql security invoker as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
before update on public.profiles
for each row execute function public.touch_profile_updated_at();

-- Public leaderboard view: only opted-in, non-sensitive fields are exposed.
create or replace view public.public_leaderboard_profiles as
select id, username, display_name, created_at
from public.profiles
where ranking_opt_in = true;

grant select on public.public_leaderboard_profiles to anon, authenticated;

