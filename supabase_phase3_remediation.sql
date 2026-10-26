-- Review only: apply AFTER Phase 3. Never run automatically or against production.
begin;
create table if not exists public.forecast_sessions (
  index_id uuid not null references public.indices(id),
  trading_date date not null,
  exchange_timezone text not null,
  is_open boolean not null,
  opens_at timestamptz,
  closes_at timestamptz,
  source_reference text not null check (length(source_reference) >= 5),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(index_id,trading_date),
  check ((is_open and opens_at is not null and closes_at is not null and closes_at > opens_at)
    or (not is_open and opens_at is null and closes_at is null))
);
alter table public.forecast_sessions enable row level security;
revoke all on public.forecast_sessions from public, anon, authenticated;
grant select,insert on public.forecast_sessions to service_role;
create or replace function public.validate_forecast_session()
returns trigger language plpgsql set search_path=public as $$
declare zone text;
begin
  select timezone into zone from public.indices where id=NEW.index_id;
  if zone is null or NEW.exchange_timezone is distinct from zone
    or (NEW.is_open and ((NEW.opens_at at time zone zone)::date <> NEW.trading_date
      or (NEW.closes_at at time zone zone)::date <> NEW.trading_date)) then
    raise exception 'Invalid dated exchange calendar';
  end if;
  NEW.recorded_at := clock_timestamp();
  return NEW;
end;
$$;
drop trigger if exists forecast_sessions_validate on public.forecast_sessions;
create trigger forecast_sessions_validate before insert on public.forecast_sessions
for each row execute function public.validate_forecast_session();

create or replace function public.get_forecast_session(p_index_id uuid,p_trading_date date)
returns jsonb language sql security definer set search_path=public as $$
  select to_jsonb(s) from public.forecast_sessions s where index_id=p_index_id and trading_date=p_trading_date;
$$;
create or replace function public.record_forecast_session(p_index_id uuid,p_trading_date date,p_window jsonb)
returns void language plpgsql security definer set search_path=public as $$
begin
  if jsonb_typeof(p_window->'is_open') is distinct from 'boolean' then raise exception 'Invalid calendar'; end if;
  insert into public.forecast_sessions(index_id,trading_date,exchange_timezone,is_open,opens_at,closes_at,source_reference)
    select id,p_trading_date,timezone,(p_window->>'is_open')::boolean,
      (p_window->>'opens_at')::timestamptz,(p_window->>'closes_at')::timestamptz,'Upstox dated timings/holidays v2'
    from public.indices where id=p_index_id and is_active
    on conflict(index_id,trading_date) do nothing;
end;
$$;
revoke all on function public.get_forecast_session(uuid,date),public.record_forecast_session(uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.get_forecast_session(uuid,date),public.record_forecast_session(uuid,date,jsonb) to service_role;

alter table public.test_periods add column if not exists client_key text check(length(client_key) between 1 and 128);
create unique index if not exists test_periods_client_key on public.test_periods(user_id,client_key) where client_key is not null;

-- Defaults on ADD apply only to old rows. No existing forecast/score is edited.
alter table public.predictions add column if not exists submission_kind text not null default 'legacy';
alter table public.predictions alter column submission_kind set default 'live';
alter table public.predictions add column if not exists verification_status text not null default 'legacy_unverified';
alter table public.predictions add column if not exists server_received_at timestamptz;
alter table public.predictions add column if not exists eligibility_deadline timestamptz;
alter table public.predictions add column if not exists import_metadata jsonb;
alter table public.predictions drop constraint if exists predictions_verification_status_check;
alter table public.predictions add constraint predictions_verification_status_check
  check (verification_status in ('verified','late','historical','calendar_unavailable','non_trading_day','legacy_unverified'));
grant insert(submission_kind) on public.predictions to authenticated;
grant insert(import_metadata) on public.predictions to authenticated;

create or replace function public.classify_forecast_receipt(imported boolean,is_open boolean,received timestamptz,opens timestamptz,recorded timestamptz)
returns text language sql immutable as $$
  select case when imported then 'historical'
    when imported is null or received is null or is_open is null then 'calendar_unavailable'
    when not is_open then 'non_trading_day'
    when opens is null or recorded is null or recorded >= opens or recorded > received then 'calendar_unavailable'
    when received >= opens then 'late' else 'verified' end;
$$;
revoke all on function public.classify_forecast_receipt(boolean,boolean,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;

create or replace function public.validate_prediction_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare session public.forecast_sessions%rowtype; zone text;
begin
  perform pg_advisory_xact_lock(hashtextextended(NEW.index_id::text || NEW.trading_date::text,0));
  if NEW.score is not null or NEW.score_details is not null
    or NEW.scoring_status <> 'pending' or NEW.scored_at is not null
    or NEW.scoring_rule_version is not null or NEW.market_session_id is not null then
    raise exception 'Scores are server-controlled' using errcode='42501';
  end if;
  if NEW.test_period_id is null then
    if NEW.submission_kind='live' then
    select id into NEW.test_period_id from public.test_periods
    where user_id=NEW.user_id and status in ('scheduled','active') and start_date <= NEW.trading_date;
    end if;
  elsif not exists(select 1 from public.test_periods where id=NEW.test_period_id
    and user_id=NEW.user_id) then
    raise exception 'Test period not found' using errcode='42501';
  end if;
  if NEW.test_period_id is not null and exists(select 1 from public.test_periods
    where id=NEW.test_period_id and start_date > NEW.trading_date) then
    raise exception 'Prediction predates test period' using errcode='22023';
  end if;
  if NEW.submission_kind not in ('live','import') then raise exception 'Invalid submission kind'; end if;
  if NEW.import_metadata is not null and (NEW.submission_kind <> 'import'
    or jsonb_typeof(NEW.import_metadata) <> 'object' or pg_column_size(NEW.import_metadata)>65536) then
    raise exception 'Invalid historical import metadata';
  end if;
  NEW.server_received_at := clock_timestamp();
  NEW.locked_at := NEW.server_received_at;
  NEW.eligibility_deadline := null;
  NEW.verification_status := 'calendar_unavailable';
  select timezone into zone from public.indices where id=NEW.index_id;
  select * into session from public.forecast_sessions where index_id=NEW.index_id and trading_date=NEW.trading_date;
  if found and session.exchange_timezone=zone then
    NEW.eligibility_deadline := session.opens_at;
    NEW.verification_status := public.classify_forecast_receipt(NEW.submission_kind='import',session.is_open,NEW.server_received_at,session.opens_at,session.recorded_at);
  elsif NEW.submission_kind='import' then NEW.verification_status := 'historical';
  end if;
  return NEW;
end;
$$;

create or replace function public.get_public_ranking()
returns table(username text,average_score numeric,accuracy_percentage numeric,completed_predictions bigint)
language sql security definer set search_path=public as $$
  select p.username,round(avg(pr.score),2),
    round(100.0*avg(case when pr.score>=60 then 1 else 0 end),2),count(pr.id)::bigint
  from public.profiles p join public.predictions pr on pr.user_id=p.id
    and pr.scoring_status='scored' and pr.verification_status='verified'
  where p.ranking_opt_in=true group by p.id,p.username having count(pr.id)>=5
  order by 2 desc,3 desc,4 desc,p.username;
$$;
revoke all on function public.get_public_ranking() from public;
grant execute on function public.get_public_ranking() to authenticated;

alter table public.market_fetch_jobs drop constraint if exists market_fetch_jobs_status_check;
alter table public.market_fetch_jobs add constraint market_fetch_jobs_status_check
check(status in ('pending','running','retry','success','closed','quarantined'));
create table if not exists public.market_data_quarantine (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.market_fetch_jobs(id),
  error_code text not null,
  audit jsonb not null,
  quarantined_at timestamptz not null default clock_timestamp()
);
alter table public.market_data_quarantine enable row level security;
revoke all on public.market_data_quarantine from public,anon,authenticated;
create or replace function public.quarantine_market_job(p_job_id uuid,p_lease uuid,p_error text,p_audit jsonb)
returns boolean language plpgsql security definer set search_path=public as $$
declare attempt integer;
begin
  if p_error not in ('INCONSISTENT_OHLC','INCONSISTENT_OPEN','INCONSISTENT_HIGH','INCONSISTENT_LOW','INCONSISTENT_CLOSE')
    or jsonb_typeof(p_audit) is distinct from 'object' then raise exception 'Invalid quarantine'; end if;
  update public.market_fetch_jobs set status='quarantined',last_error=p_error,lease_until=null,updated_at=now()
    where id=p_job_id and lease_token=p_lease and status='running' returning attempts into attempt;
  if not found then return false; end if;
  insert into public.market_data_quarantine(job_id,error_code,audit) values(p_job_id,p_error,p_audit);
  insert into public.market_fetch_attempts(job_id,attempt,status,error_code) values(p_job_id,attempt,'quarantined',p_error);
  return true;
end;
$$;
revoke all on function public.quarantine_market_job(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.quarantine_market_job(uuid,uuid,text,jsonb) to service_role;

-- Keep the original canonical insertion and scoring implementation, but only
-- callable through the reconciliation boundary below. Reapplying is safe.
do $$ begin
  if to_regprocedure('public.publish_market_session_unchecked(jsonb)') is null then
    alter function public.publish_market_session(jsonb) rename to publish_market_session_unchecked;
  end if;
end $$;
revoke all on function public.publish_market_session_unchecked(jsonb) from public,anon,authenticated,service_role;
create or replace function public.publish_market_session(p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  bars jsonb; daily jsonb; candle jsonb; n integer; expected integer;
  first_open numeric; max_high numeric; min_low numeric; last_close numeric;
  op numeric; hi numeric; lo numeric; cl numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended((p_result->>'index_id') || (p_result->>'trading_date'),0));
  if exists(select 1 from public.market_sessions where index_id=(p_result->>'index_id')::uuid
    and trading_date=(p_result->>'trading_date')::date) then
    return public.publish_market_session_unchecked(p_result);
  end if;
  bars := p_result#>'{raw_market_data,intraday,data,candles}';
  daily := p_result#>'{raw_market_data,daily,data,candles}';
  if jsonb_typeof(bars) is distinct from 'array' or jsonb_typeof(daily) is distinct from 'array'
    or jsonb_array_length(bars)=0 then raise exception 'Reconciliation requires raw candles'; end if;
  op := (p_result->>'open')::numeric; hi := (p_result->>'high')::numeric;
  lo := (p_result->>'low')::numeric; cl := (p_result->>'close')::numeric;
  select count(*) into n from jsonb_array_elements(bars) v;
  expected := ceil(extract(epoch from ((p_result->>'session_close_at')::timestamptz-(p_result->>'session_open_at')::timestamptz))/900);
  if n<>expected or exists(select 1 from jsonb_array_elements(bars) v
      where jsonb_typeof(v) is distinct from 'array' or jsonb_array_length(v)<5
      or (v->>0) !~ '(Z|[+-][0-9]{2}:[0-9]{2})$'
      or (v->>0)::timestamptz < (p_result->>'session_open_at')::timestamptz
      or (v->>0)::timestamptz >= (p_result->>'session_close_at')::timestamptz
      or mod(extract(epoch from ((v->>0)::timestamptz-(p_result->>'session_open_at')::timestamptz)),900)<>0
      or (v->>3)::numeric<=0 or (v->>3)::numeric>least((v->>1)::numeric,(v->>4)::numeric)
      or (v->>2)::numeric<greatest((v->>1)::numeric,(v->>4)::numeric)
      or exists(select 1 from jsonb_array_elements_text(v) with ordinality x(value,pos)
        where pos between 2 and 5 and (value is null or value in ('NaN','Infinity','-Infinity'))))
    or (select count(distinct (v->>0)::timestamptz) from jsonb_array_elements(bars) v)<>n then
    raise exception 'Invalid intraday reconciliation coverage';
  end if;
  select (v->>1)::numeric into first_open from jsonb_array_elements(bars) v order by (v->>0)::timestamptz limit 1;
  select (v->>4)::numeric into last_close from jsonb_array_elements(bars) v order by (v->>0)::timestamptz desc limit 1;
  select max((v->>2)::numeric),min((v->>3)::numeric) into max_high,min_low from jsonb_array_elements(bars) v;
  if abs(first_open-op)>greatest(.05,abs(op)*.00001)
    or abs(max_high-hi)>greatest(.05,abs(hi)*.00001)
    or abs(min_low-lo)>greatest(.05,abs(lo)*.00001)
    or abs(last_close-cl)>greatest(.05,abs(cl)*.00001) then raise exception 'Inconsistent OHLC reconciliation'; end if;
  select v into candle from jsonb_array_elements(daily) v where
    ((v->>0)::timestamptz at time zone (select timezone from public.indices where id=(p_result->>'index_id')::uuid))::date=(p_result->>'trading_date')::date;
  if (select count(*) from jsonb_array_elements(daily) v where
      ((v->>0)::timestamptz at time zone (select timezone from public.indices where id=(p_result->>'index_id')::uuid))::date=(p_result->>'trading_date')::date)<>1
    or candle is null or (candle->>1)::numeric is distinct from op or (candle->>2)::numeric is distinct from hi
    or (candle->>3)::numeric is distinct from lo or (candle->>4)::numeric is distinct from cl then
    raise exception 'Daily candle does not match published prices'; end if;
  return public.publish_market_session_unchecked(p_result);
end;
$$;
revoke all on function public.publish_market_session(jsonb) from public,anon,authenticated;
grant execute on function public.publish_market_session(jsonb) to service_role;
revoke all on function public.validate_forecast_session() from public,anon,authenticated;
-- Immutable prediction trigger is replaced below; existing scoring rules stay intact.
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
     or NEW.test_period_id is distinct from OLD.test_period_id
     or NEW.submission_kind is distinct from OLD.submission_kind
     or NEW.verification_status is distinct from OLD.verification_status
     or NEW.server_received_at is distinct from OLD.server_received_at
     or NEW.eligibility_deadline is distinct from OLD.eligibility_deadline
     or NEW.import_metadata is distinct from OLD.import_metadata then
    raise exception 'Locked predictions cannot be edited';
  end if;

  if coalesce(current_setting('app.prediction_scoring', true), '') <> '1' then
    raise exception 'Prediction updates are restricted to the scoring operation';
  end if;
  return NEW;
end;
$$;


commit;
