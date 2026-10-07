// Executes the real SQL, grants and RLS in PostgreSQL/WASM; no production credentials.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db = new PGlite();
const a = '00000000-0000-0000-0000-000000000001';
const b = '00000000-0000-0000-0000-000000000002';
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log('PASS ' + name);
  passed++;
}
async function as(role, user, fn) {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || '']);
  try { return await fn(); }
  finally { await db.exec('reset role'); }
}
const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  insert into auth.users values ('${a}'),('${b}');
`);
for (const file of ['supabase_profile_schema.sql','supabase_phase1_schema.sql','supabase_phase2_schema.sql','supabase_phase3_schema.sql']) {
  await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'));
}
await test('migration is repeatable', async () => {
  await db.exec(await readFile(new URL('../supabase_phase3_schema.sql', import.meta.url),'utf8'));
});
const index = await scalar("select id from public.indices where code='NIFTY50'");
const insertPrediction = (user, day='2025-09-30') => as('authenticated',user,async () =>
  scalar(`insert into public.predictions(user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance)
    values($1,$2,$3,'Bullish','Flat','Range',95,105) returning id`, [user,index,day]));
const pa = await insertPrediction(a);
const pb = await insertPrediction(b);
const result = {
  index_id:index,trading_date:'2025-09-30',provider:'upstox',instrument_id:'NSE_INDEX|Nifty 50',
  timeframe:'1d+15m',fetch_status:'valid',previous_close:100,open:100,high:105,low:95,close:101,
  actual_bias:'Bullish',actual_opening:'Flat',actual_day_type:'Range',
  session_open_at:'2025-09-30T09:15:00+05:30',session_close_at:'2025-09-30T15:30:00+05:30',
  fetched_at:'2025-09-30T16:30:00+05:30',raw_market_data:{data:'audit'},methodology:{version:'test'},
};
const publish = (r=result) => as('service_role',null,() => scalar('select public.publish_market_session($1::jsonb)',[JSON.stringify(r)]));
await test('two-user RLS isolation and score ownership', async () => {
  await as('authenticated',a,async () => {
    assert.equal(await scalar('select count(*)::int from public.predictions'),1);
    await assert.rejects(db.query('select public.score_prediction($1)',[pb]), /Prediction not found/);
  });
});
await test('untrusted users cannot publish, claim jobs or invoke private scorer', async () => {
  for (const role of ['anon','authenticated']) await as(role,a,async () => {
    await assert.rejects(db.query('select public.publish_market_session($1::jsonb)',[JSON.stringify(result)]),/permission denied/);
    await assert.rejects(db.query("select public.claim_market_jobs('upstox')"),/permission denied/);
    await assert.rejects(db.query('select public.score_prediction_internal($1)',[pa]),/permission denied/);
    await assert.rejects(db.query('select * from public.market_fetch_jobs'),/permission denied/);
  });
});
await test('clients cannot insert authoritative scores or backdate lock timestamps', async () => {
  await as('authenticated',a,async () => {
    await assert.rejects(db.query(`insert into public.predictions
      (user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance,score)
      values($1,$2,'2025-09-29','Bullish','Flat','Range',95,105,100)`,[a,index]),/permission denied/);
    await assert.rejects(db.query(`insert into public.predictions
      (user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance,locked_at)
      values($1,$2,'2025-09-29','Bullish','Flat','Range',95,105,'2020-01-01')`,[a,index]),/permission denied/);
    await assert.rejects(db.query('update public.predictions set score=100 where id=$1',[pa]),/permission denied/);
  });
});
await test('one publication scores all users with identical immutable session reference', async () => {
  const published = await publish();
  assert.equal(published.scored,2);
  const {rows} = await db.query('select score,scoring_status,market_session_id from public.predictions order by id');
  assert.equal(rows.length,2);
  assert.deepEqual(rows[0],rows[1]);
  assert.equal(Number(rows[0].score),100);
  assert.equal(rows[0].market_session_id,published.session_id);
});
await test('duplicate publication and repeated scoring preserve values and timestamps', async () => {
  const before = await db.query('select * from public.predictions order by id');
  const first = await publish();
  const second = await publish({...result,close:104,actual_bias:'Bearish'});
  assert.equal(first.session_id,second.session_id);
  assert.equal(second.scored,0);
  assert.equal(await scalar('select count(*)::int from public.market_sessions'),1);
  assert.equal(Number(await scalar('select close from public.market_sessions')),101);
  await as('authenticated',a,() => db.query('select public.score_prediction($1)',[pa]));
  assert.deepEqual((await db.query('select * from public.predictions order by id')).rows,before.rows);
});
await test('published sessions cannot be edited and raw audit is private', async () => {
  await assert.rejects(db.exec('update public.market_sessions set close=104'),/immutable/);
  await as('authenticated',a,async () => {
    assert.equal(await scalar('select count(id)::int from public.market_sessions'),1);
    await assert.rejects(db.exec('select raw_market_data from public.market_sessions'),/permission denied/);
    await assert.rejects(db.exec('select methodology from public.market_sessions'),/permission denied/);
  });
});
await test('incomplete, invalid or future results cannot create a session', async () => {
  for (const bad of [
    {close:null}, {low:110}, {session_close_at:'2099-01-01T15:30:00+05:30'},
    {actual_day_type:null}, {fetch_status:'pending'}, {fetch_status:'manual'}, {high:'NaN'},
  ]) await assert.rejects(publish({...result,trading_date:'2025-09-29',...bad}));
  assert.equal(await scalar('select count(*)::int from public.market_sessions'),1);
});
await test('test periods retain 1–365 session range and cross-user ownership', async () => {
  let period;
  await as('authenticated',b,async () => {
    period = await scalar("insert into public.test_periods(user_id,start_date,duration_sessions) values($1,'2025-09-30',365) returning id",[b]);
    await assert.rejects(db.query("insert into public.test_periods(user_id,start_date,duration_sessions,status) values($1,'2025-09-30',366,'stopped')",[b]));
  });
  await as('authenticated',a,async () => {
    await db.query("insert into public.test_periods(user_id,start_date,duration_sessions) values($1,'2025-09-30',1)",[a]);
    await assert.rejects(db.query(`insert into public.predictions
      (user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance,test_period_id)
      values($1,$2,'2025-09-29','Bullish','Flat','Range',95,105,$3)`,[a,index,period]),/Test period not found/);
  });
});
await test('late arriving prediction scores against the published session', async () => {
  const c='00000000-0000-0000-0000-000000000003';
  await db.query('insert into auth.users values($1)',[c]);
  const pc=await insertPrediction(c);
  assert.equal(await scalar('select scoring_status from public.predictions where id=$1',[pc]),'scored');
});
await test('duplicate claims, lease recovery, stale worker, retry and audit', async () => {
  await insertPrediction(a,'2025-10-01');
  const claim=() => as('service_role',null,() => scalar("select public.claim_market_jobs('upstox')"));
  const jobs=await claim();
  assert.equal(jobs.length,1);
  assert.equal((await claim()).length,0);
  await db.exec("update public.market_fetch_jobs set lease_until=now()-interval '1 minute'");
  const recovered=(await claim())[0];
  assert.notEqual(recovered.lease_token,jobs[0].lease_token);
  const finish=(job) => as('service_role',null,() => scalar(
    "select public.finish_market_job($1,$2,'retry','PROVIDER_RATE_LIMIT',3600)",[job.job_id,job.lease_token]));
  assert.equal(await finish(jobs[0]),false);
  assert.equal(await finish(recovered),true);
  await insertPrediction(b,'2025-10-02'); // unclaimed jobs must respect provider cooldown too
  assert.equal((await claim()).length,0);
  assert.equal(await scalar('select count(*)::int from public.market_fetch_attempts'),1);
  await as('service_role',null,() => db.query('select public.retry_market_job($1)',[recovered.job_id]));
  assert.equal((await claim()).length,2);
});
await test('account deletion still cascades owned predictions and test periods', async () => {
  await db.query('delete from auth.users where id=$1',[b]);
  assert.equal(await scalar('select count(*)::int from public.predictions where user_id=$1',[b]),0);
  assert.equal(await scalar('select count(*)::int from public.test_periods where user_id=$1',[b]),0);
  assert.equal(await scalar('select count(*)::int from public.market_sessions'),1);
});
console.log(`${passed} PostgreSQL integration checks passed`);
await db.close();
