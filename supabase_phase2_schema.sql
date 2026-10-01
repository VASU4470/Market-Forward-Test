-- PiZero Priority 2 schema.
-- Additive and idempotent: preserves existing profiles, indices, predictions,
-- market sessions, and user-controlled test history.

create table if not exists public.test_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  duration_sessions integer not null,
  end_date date,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc', now()),
  completed_at timestamptz,
  constraint test_periods_duration_range check (duration_sessions between 1 and 365),
  constraint test_periods_status_check check (status in ('scheduled', 'active', 'completed', 'stopped')),
  constraint test_periods_completion_check check (
    (status = 'completed' and completed_at is not null)
    or status <> 'completed'
  )
);

alter table public.test_periods enable row level security;
grant select, insert, update on public.test_periods to authenticated;

drop policy if exists "Users can read their test periods" on public.test_periods;
create policy "Users can read their test periods"
  on public.test_periods for select
  using (auth.uid() = user_id);

drop policy if exists "Users can create their test periods" on public.test_periods;
create policy "Users can create their test periods"
  on public.test_periods for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their test periods" on public.test_periods;
create policy "Users can update their test periods"
  on public.test_periods for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create unique index if not exists test_periods_one_open_per_user_idx
  on public.test_periods (user_id)
  where status in ('scheduled', 'active');
create index if not exists test_periods_user_created_idx
  on public.test_periods (user_id, created_at desc);

alter table public.predictions add column if not exists test_period_id uuid references public.test_periods(id) on delete set null;
alter table public.predictions add column if not exists score numeric;
alter table public.predictions add column if not exists score_details jsonb;
alter table public.predictions add column if not exists scoring_status text not null default 'pending';
alter table public.predictions add column if not exists scored_at timestamptz;
alter table public.predictions add column if not exists scoring_rule_version text;

alter table public.predictions drop constraint if exists predictions_scoring_status_check;
alter table public.predictions add constraint predictions_scoring_status_check
  check (scoring_status in ('pending', 'scored', 'unavailable'));
alter table public.predictions drop constraint if exists predictions_score_range_check;
alter table public.predictions add constraint predictions_score_range_check
  check (score is null or (score >= 0 and score <= 100));
alter table public.predictions drop constraint if exists predictions_scored_fields_check;
alter table public.predictions add constraint predictions_scored_fields_check
  check ((scoring_status = 'scored' and score is not null and scored_at is not null and scoring_rule_version is not null)
      or scoring_status <> 'scored');

-- Authenticated clients may create forecasts, but never write authoritative
-- score fields directly. The protected RPC is the only scoring write path.
revoke insert (score, score_details, scoring_status, scored_at, scoring_rule_version)
  on public.predictions from authenticated;

create index if not exists predictions_user_scoring_idx
  on public.predictions (user_id, scoring_status, trading_date desc);
create index if not exists predictions_test_period_idx
  on public.predictions (test_period_id, trading_date desc);

-- Forecast fields and lock metadata are immutable after insertion. The only
-- permitted update path is the protected scoring function below.
create or replace function public.prevent_prediction_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if NEW.user_id is distinct from OLD.user_id
     or NEW.index_id is distinct from OLD.index_id
     or NEW.trading_date is distinct from OLD.trading_date
     or NEW.bias is distinct from OLD.bias
     or NEW.opening_view is distinct from OLD.opening_view
     or NEW.day_type is distinct from OLD.day_type
     or NEW.support is distinct from OLD.support
     or NEW.resistance is distinct from OLD.resistance
     or NEW.locked_at is distinct from OLD.locked_at
     or NEW.test_period_id is distinct from OLD.test_period_id then
    raise exception 'Locked predictions cannot be edited';
  end if;

  if current_setting('app.prediction_scoring', true) <> '1' then
    raise exception 'Prediction updates are restricted to the scoring operation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists predictions_immutable_after_lock on public.predictions;
create trigger predictions_immutable_after_lock
before update on public.predictions
for each row execute function public.prevent_prediction_mutation();

-- Server-authoritative, authenticated, atomic, idempotent scoring. It reads
-- only the persisted market session for the prediction's index/date; clients
-- cannot submit actual market values to this function.
create or replace function public.score_prediction(p_prediction_id uuid)
returns public.predictions
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.predictions%rowtype;
  m public.market_sessions%rowtype;
  support_tolerance numeric;
  resistance_tolerance numeric;
  support_points numeric;
  resistance_points numeric;
  total_score numeric;
  rule_version constant text := 'p2-v1';
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select * into p
  from public.predictions
  where id = p_prediction_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Prediction not found' using errcode = 'P0002';
  end if;

  if p.scoring_status = 'scored' then
    return p;
  end if;

  select * into m
  from public.market_sessions
  where index_id = p.index_id and trading_date = p.trading_date;

  if not found or m.low is null or m.high is null
     or m.actual_bias is null or m.actual_opening is null or m.actual_day_type is null then
    return p;
  end if;

  support_tolerance := greatest(25, p.support * 0.0025);
  resistance_tolerance := greatest(25, p.resistance * 0.0025);
  support_points := greatest(0, 17.5 * (1 - abs(m.low - p.support) / support_tolerance));
  resistance_points := greatest(0, 17.5 * (1 - abs(m.high - p.resistance) / resistance_tolerance));
  total_score := round(
    (case when p.bias = m.actual_bias then 25 else 0 end)
    + (case when p.opening_view = m.actual_opening then 20 else 0 end)
    + (case when p.day_type = m.actual_day_type then 20 else 0 end)
    + support_points + resistance_points
  );

  perform set_config('app.prediction_scoring', '1', true);
  update public.predictions
  set score = total_score,
      score_details = jsonb_build_object(
        'bias', case when p.bias = m.actual_bias then 25 else 0 end,
        'opening', case when p.opening_view = m.actual_opening then 20 else 0 end,
        'day_type', case when p.day_type = m.actual_day_type then 20 else 0 end,
        'support', support_points,
        'resistance', resistance_points
      ),
      scoring_status = 'scored',
      scored_at = timezone('utc', now()),
      scoring_rule_version = rule_version
  where id = p.id and scoring_status = 'pending'
  returning * into p;
  perform set_config('app.prediction_scoring', '', true);
  return p;
end;
$$;

revoke all on function public.score_prediction(uuid) from public;
grant execute on function public.score_prediction(uuid) to authenticated;

-- Ranking is derived only from explicitly opted-in profiles and scored rows.
create index if not exists profiles_ranking_opt_in_idx
  on public.profiles (ranking_opt_in, username_normalized)
  where ranking_opt_in = true;

create or replace function public.get_public_ranking()
returns table (
  username text,
  average_score numeric,
  accuracy_percentage numeric,
  completed_predictions bigint
)
language sql
security definer
set search_path = public
as $$
  select
    p.username,
    round(avg(pr.score), 2) as average_score,
    round(100.0 * avg(case when pr.score >= 60 then 1 else 0 end), 2) as accuracy_percentage,
    count(pr.id)::bigint as completed_predictions
  from public.profiles p
  join public.predictions pr on pr.user_id = p.id and pr.scoring_status = 'scored'
  where p.ranking_opt_in = true
  group by p.id, p.username
  having count(pr.id) >= 5
  order by average_score desc, accuracy_percentage desc, completed_predictions desc, p.username asc;
$$;

revoke all on function public.get_public_ranking() from public;
grant execute on function public.get_public_ranking() to authenticated;
