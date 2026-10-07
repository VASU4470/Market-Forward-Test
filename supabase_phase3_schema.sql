-- Priority 3. Apply AFTER phase 2, in one transaction. Never rewrites past scores.
begin;
alter table public.market_sessions add column if not exists instrument_id text;
alter table public.market_sessions add column if not exists timeframe text;
alter table public.market_sessions add column if not exists fetch_status text not null default 'legacy';
alter table public.market_sessions add column if not exists fetched_at timestamptz;
alter table public.market_sessions add column if not exists session_open_at timestamptz;
alter table public.market_sessions add column if not exists session_close_at timestamptz;
alter table public.predictions add column if not exists market_session_id uuid references public.market_sessions(id);
-- Existing index/date uniqueness is stronger than provider/index/date uniqueness.
create unique index if not exists market_sessions_provider_index_day_idx
  on public.market_sessions(provider, index_id, trading_date);

-- Audit payloads are server-only. Authenticated clients can read normalized outcomes.
revoke all on public.market_sessions from anon, authenticated;
grant select (id,index_id,trading_date,previous_close,open,high,low,close,
  actual_bias,actual_opening,actual_day_type,provider,instrument_id,timeframe,
  fetch_status,fetched_at,session_open_at,session_close_at,created_at)
  on public.market_sessions to authenticated;
revoke update, delete on public.predictions from anon, authenticated;
-- Table-level INSERT overrides column-level revokes. Replace it with an allowlist.
revoke insert on public.predictions from authenticated;
grant insert (user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance,test_period_id)
  on public.predictions to authenticated;

create table if not exists public.market_fetch_jobs (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  index_id uuid not null references public.indices(id),
  trading_date date not null,
  status text not null default 'pending' check (status in ('pending','running','retry','success','closed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  last_error text,
  updated_at timestamptz not null default now(),
  unique(provider,index_id,trading_date)
);
create index if not exists market_fetch_due_idx on public.market_fetch_jobs(next_attempt_at)
  where status in ('pending','retry','running');
create table if not exists public.market_fetch_attempts (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.market_fetch_jobs(id),
  attempt integer not null,
  status text not null,
  error_code text,
  finished_at timestamptz not null default now()
);
alter table public.market_fetch_jobs enable row level security;
alter table public.market_fetch_attempts enable row level security;
revoke all on public.market_fetch_jobs, public.market_fetch_attempts from anon, authenticated;

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

  if coalesce(current_setting('app.prediction_scoring', true), '') <> '1' then
    raise exception 'Prediction updates are restricted to the scoring operation';
  end if;
  return NEW;
end;
$$;

drop trigger if exists predictions_immutable_after_lock on public.predictions;
create trigger predictions_immutable_after_lock
before update on public.predictions
for each row execute function public.prevent_prediction_mutation();

create or replace function public.score_prediction_internal(p_prediction_id uuid)
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
  select * into p
  from public.predictions
  where id = p_prediction_id
  for update;

  if not found then
    raise exception 'Prediction not found' using errcode = 'P0002';
  end if;

  if p.scoring_status <> 'pending' then
    return p;
  end if;

  select * into m
  from public.market_sessions
  where index_id = p.index_id and trading_date = p.trading_date;

  if not found or m.fetch_status not in ('valid', 'manual', 'legacy') or m.low is null or m.high is null
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
  set market_session_id = m.id,
      score = total_score,
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

revoke all on function public.score_prediction_internal(uuid) from public, anon, authenticated, service_role;

create or replace function public.score_prediction(p_prediction_id uuid)
returns public.predictions language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.predictions where id = p_prediction_id and user_id = auth.uid()
  ) then
    raise exception 'Prediction not found' using errcode = '42501';
  end if;
  return public.score_prediction_internal(p_prediction_id);
end;
$$;
revoke all on function public.score_prediction(uuid) from public, anon;
grant execute on function public.score_prediction(uuid) to authenticated;

create or replace function public.validate_prediction_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(NEW.index_id::text || NEW.trading_date::text, 0));
  if NEW.score is not null or NEW.score_details is not null
    or NEW.scoring_status <> 'pending' or NEW.scored_at is not null
    or NEW.scoring_rule_version is not null or NEW.market_session_id is not null then
    raise exception 'Scores are server-controlled' using errcode = '42501';
  end if;
  if NEW.test_period_id is not null and not exists (
    select 1 from public.test_periods where id = NEW.test_period_id and user_id = NEW.user_id
  ) then
    raise exception 'Test period not found' using errcode = '42501';
  end if;
  NEW.locked_at := now();
  return NEW;
end;
$$;
drop trigger if exists predictions_validate_insert on public.predictions;
create trigger predictions_validate_insert before insert on public.predictions
  for each row execute function public.validate_prediction_insert();

-- Imported/late-arriving locked predictions use the SAME stored session as everyone else.
create or replace function public.score_inserted_prediction()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.score_prediction_internal(NEW.id);
  return NEW;
end;
$$;
drop trigger if exists predictions_score_after_insert on public.predictions;
create trigger predictions_score_after_insert after insert on public.predictions
  for each row execute function public.score_inserted_prediction();

create or replace function public.market_session_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Published market sessions are immutable';
end;
$$;
drop trigger if exists market_session_no_rewrite on public.market_sessions;
create trigger market_session_no_rewrite before update or delete on public.market_sessions
  for each row execute function public.market_session_immutable();

-- Single atomic transaction: publish once, then score every pending prediction.
create or replace function public.publish_market_session(p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m public.market_sessions%rowtype;
  candidate public.market_sessions%rowtype;
  prediction_id uuid;
  scored integer := 0;
  v_index uuid := (p_result->>'index_id')::uuid;
  v_date date := (p_result->>'trading_date')::date;
begin
  if v_index is null or v_date is null then raise exception 'Index and date required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_index::text || v_date::text, 0));
  select * into m from public.market_sessions where index_id = v_index and trading_date = v_date;
  if not found then
    candidate := jsonb_populate_record(null::public.market_sessions, p_result);
    if candidate.provider is null or candidate.instrument_id is null
      or candidate.timeframe is distinct from '1d+15m'
      or candidate.fetch_status is null or candidate.fetch_status not in ('valid','manual')
      or candidate.previous_close is null or candidate.previous_close <= 0
      or candidate.open is null or candidate.high is null or candidate.low is null or candidate.close is null
      or candidate.previous_close::text in ('NaN','Infinity','-Infinity')
      or candidate.open::text in ('NaN','Infinity','-Infinity')
      or candidate.high::text in ('NaN','Infinity','-Infinity')
      or candidate.low::text in ('NaN','Infinity','-Infinity')
      or candidate.close::text in ('NaN','Infinity','-Infinity')
      or candidate.low <= 0 or candidate.low > least(candidate.open,candidate.close)
      or candidate.high < greatest(candidate.open,candidate.close)
      or candidate.actual_bias is null or candidate.actual_bias not in ('Bullish','Bearish','Sideways')
      or candidate.actual_opening is null or candidate.actual_opening not in ('Gap Up','Gap Down','Flat')
      or candidate.actual_day_type is null or candidate.actual_day_type not in ('Trend','Range','Reversal')
      or candidate.session_open_at is null or candidate.session_close_at is null
      or candidate.session_close_at <= candidate.session_open_at
      or (candidate.session_open_at at time zone 'Asia/Kolkata')::date <> v_date
      or (candidate.session_close_at at time zone 'Asia/Kolkata')::date <> v_date
      or candidate.session_close_at + interval '30 minutes' > now()
      or candidate.fetched_at is null or candidate.fetched_at < candidate.session_close_at
      or candidate.fetched_at > now() + interval '5 minutes'
      or jsonb_typeof(p_result->'raw_market_data') is distinct from 'object'
      or jsonb_typeof(p_result->'methodology') is distinct from 'object'
      or not exists (select 1 from public.indices where id = v_index and is_active) then
      raise exception 'Invalid or incomplete market session';
    end if;
    if candidate.fetch_status = 'manual' and (
      nullif(candidate.methodology->>'administrator_id','') is null
      or nullif(candidate.methodology->>'reason','') is null
      or nullif(candidate.methodology->>'source_reference','') is null
    ) then raise exception 'Manual result requires administrator audit'; end if;
    insert into public.market_sessions (
      index_id,trading_date,provider,instrument_id,timeframe,fetch_status,fetched_at,
      session_open_at,session_close_at,previous_close,open,high,low,close,
      actual_bias,actual_opening,actual_day_type,raw_market_data,methodology
    ) values (
      v_index,v_date,candidate.provider,candidate.instrument_id,candidate.timeframe,
      candidate.fetch_status,candidate.fetched_at,candidate.session_open_at,candidate.session_close_at,
      candidate.previous_close,candidate.open,candidate.high,candidate.low,candidate.close,
      candidate.actual_bias,candidate.actual_opening,candidate.actual_day_type,
      candidate.raw_market_data,candidate.methodology
    ) returning * into m;
  end if;
  for prediction_id in select id from public.predictions
    where index_id = v_index and trading_date = v_date and scoring_status = 'pending' order by id
  loop
    perform public.score_prediction_internal(prediction_id);
    scored := scored + 1;
  end loop;
  return jsonb_build_object('session_id',m.id,'scored',scored,'provider',m.provider,'fetch_status',m.fetch_status);
end;
$$;
revoke all on function public.publish_market_session(jsonb) from public, anon, authenticated;
grant execute on function public.publish_market_session(jsonb) to service_role;

create or replace function public.claim_market_jobs(p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  result jsonb;
begin
  if p_provider <> 'upstox' then raise exception 'Unsupported provider'; end if;
  -- Serialize claims globally so concurrent schedulers cannot amplify the API rate.
  perform pg_advisory_xact_lock(3903001);
  -- Provider-wide cooldown applies to NEW jobs too, not only the failed index.
  if exists(select 1 from public.market_fetch_jobs where provider=p_provider
    and status='retry' and next_attempt_at > now()
    and last_error in ('PROVIDER_RATE_LIMIT','PROVIDER_AUTH_FAILED','TOKEN_MISSING')) then
    return '[]'::jsonb;
  end if;
  if exists(select 1 from public.market_fetch_jobs where status = 'running' and lease_until > now()) then
    return '[]'::jsonb;
  end if;
  insert into public.market_fetch_jobs(provider,index_id,trading_date)
    select distinct p_provider,p.index_id,p.trading_date from public.predictions p
    join public.indices i on i.id = p.index_id and i.is_active
    where p.scoring_status = 'pending' and p.trading_date <= (now() at time zone 'Asia/Kolkata')::date
  on conflict(provider,index_id,trading_date) do nothing;
  with due as (
    select id from public.market_fetch_jobs
    where provider = p_provider and (
      (status in ('pending','retry') and next_attempt_at <= now())
      or (status = 'running' and lease_until <= now())
    ) order by next_attempt_at,trading_date limit 3 for update skip locked
  ), claimed as (
    update public.market_fetch_jobs j set status = 'running',attempts = attempts + 1,
      lease_until = now() + interval '20 minutes',lease_token = gen_random_uuid(),updated_at = now()
    from due where j.id = due.id returning j.*
  ) select coalesce(jsonb_agg(jsonb_build_object(
    'job_id',j.id,'lease_token',j.lease_token,'attempts',j.attempts,'trading_date',j.trading_date,
    'id',i.id,'code',i.code,'exchange',i.exchange,'provider_instrument_key',i.provider_instrument_key,
    'existing_session',exists(select 1 from public.market_sessions m where m.index_id=i.id and m.trading_date=j.trading_date)
  )), '[]'::jsonb) into result from claimed j join public.indices i on i.id = j.index_id;
  return result;
end;
$$;
revoke all on function public.claim_market_jobs(text) from public, anon, authenticated;
grant execute on function public.claim_market_jobs(text) to service_role;

create or replace function public.finish_market_job(p_job_id uuid,p_lease uuid,p_status text,p_error text,p_retry_seconds integer)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  attempt integer;
begin
  if p_status not in ('success','retry','closed') then raise exception 'Invalid status'; end if;
  update public.market_fetch_jobs set status=p_status,last_error=p_error,
    next_attempt_at=now()+make_interval(secs=>greatest(60,least(86400,p_retry_seconds))),
    lease_until=null,updated_at=now()
    where id=p_job_id and lease_token=p_lease and status='running' returning attempts into attempt;
  if not found then return false; end if;
  insert into public.market_fetch_attempts(job_id,attempt,status,error_code)
    values(p_job_id,attempt,p_status,p_error);
  return true;
end;
$$;
revoke all on function public.finish_market_job(uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.finish_market_job(uuid,uuid,text,text,integer) to service_role;

create or replace function public.get_market_collection_status()
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(to_jsonb(j) - 'lease_token'), '[]'::jsonb)
  from (select * from public.market_fetch_jobs order by updated_at desc limit 100) j;
$$;
create or replace function public.retry_market_job(p_job_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.market_fetch_jobs set status='retry',next_attempt_at=now(),updated_at=now()
    where id=p_job_id and (lease_until is null or lease_until <= now());
$$;
revoke all on function public.get_market_collection_status(), public.retry_market_job(uuid)
  from public, anon, authenticated;
grant execute on function public.get_market_collection_status(), public.retry_market_job(uuid) to service_role;
revoke all on function public.validate_prediction_insert(), public.score_inserted_prediction(), public.market_session_immutable()
  from public, anon, authenticated;
commit;
