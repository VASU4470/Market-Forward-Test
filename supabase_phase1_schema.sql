-- PiZero Phase 1 schema. Safe to run after supabase_profile_schema.sql.
-- Existing rows are preserved. All statements are idempotent where practical.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_normalized text generated always as (lower(username)) stored,
  display_name text not null,
  mobile_number text,
  onboarding jsonb not null default '{}'::jsonb,
  ranking_opt_in boolean not null default false,
  preferred_language text not null default 'en',
  profile_completed boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,24}$'),
  constraint profiles_username_unique unique (username_normalized)
);
grant select, insert, update on public.profiles to authenticated;

alter table public.profiles add column if not exists mobile_number text;
alter table public.profiles add column if not exists onboarding jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists profile_completed boolean not null default false;
alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select using (auth.uid() = id);
drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create table if not exists public.indices (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  display_name text not null,
  exchange text not null,
  provider_instrument_key text,
  timezone text not null default 'Asia/Kolkata',
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default timezone('utc', now())
);
grant select on public.indices to anon, authenticated;
alter table public.indices enable row level security;
drop policy if exists "Anyone can read active indices" on public.indices;
create policy "Anyone can read active indices" on public.indices for select using (is_active = true);
create index if not exists indices_active_order_idx on public.indices (is_active, sort_order, display_name);

insert into public.indices (code, display_name, exchange, provider_instrument_key, sort_order)
values
  ('NIFTY50', 'NIFTY 50', 'NSE', 'NSE_INDEX|Nifty 50', 10),
  ('BANKNIFTY', 'BANK NIFTY', 'NSE', 'NSE_INDEX|Nifty Bank', 20),
  ('FINNIFTY', 'FINNIFTY', 'NSE', 'NSE_INDEX|Nifty Fin Service', 30),
  ('SENSEX', 'SENSEX', 'BSE', 'BSE_INDEX|SENSEX', 40),
  ('BANKEX', 'BANKEX', 'BSE', 'BSE_INDEX|BANKEX', 50)
on conflict (code) do update set
  display_name = excluded.display_name,
  exchange = excluded.exchange,
  provider_instrument_key = excluded.provider_instrument_key,
  sort_order = excluded.sort_order;

create table if not exists public.predictions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  index_id uuid not null references public.indices(id),
  trading_date date not null,
  bias text not null,
  opening_view text not null,
  day_type text not null,
  support numeric not null,
  resistance numeric not null,
  locked_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  constraint predictions_one_per_user_index_day unique (user_id, index_id, trading_date),
  constraint predictions_support_positive check (support >= 0),
  constraint predictions_resistance_positive check (resistance >= 0)
);
grant select, insert on public.predictions to authenticated;
alter table public.predictions enable row level security;
drop policy if exists "Users can read their predictions" on public.predictions;
create policy "Users can read their predictions" on public.predictions for select using (auth.uid() = user_id);
drop policy if exists "Users can create their predictions" on public.predictions;
create policy "Users can create their predictions" on public.predictions for insert with check (auth.uid() = user_id);
create index if not exists predictions_user_date_idx on public.predictions (user_id, trading_date desc);
create index if not exists predictions_index_date_idx on public.predictions (index_id, trading_date desc);

create table if not exists public.market_sessions (
  id uuid primary key default gen_random_uuid(),
  index_id uuid not null references public.indices(id),
  trading_date date not null,
  previous_close numeric,
  open numeric,
  high numeric,
  low numeric,
  close numeric,
  actual_bias text,
  actual_opening text,
  actual_day_type text,
  provider text,
  raw_market_data jsonb not null default '{}'::jsonb,
  methodology jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  constraint market_sessions_one_per_index_day unique (index_id, trading_date)
);
grant select on public.market_sessions to authenticated;
alter table public.market_sessions enable row level security;
drop policy if exists "Authenticated users can read market sessions" on public.market_sessions;
create policy "Authenticated users can read market sessions" on public.market_sessions for select to authenticated using (true);
create index if not exists market_sessions_index_date_idx on public.market_sessions (index_id, trading_date desc);
