import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite();let passed=0;
const a='00000000-0000-0000-0000-000000000001', b='00000000-0000-0000-0000-000000000002';
const scalar=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0])[0];
async function as(role,user,fn){await db.exec('set role '+role);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);try{return await fn();}finally{await db.exec('reset role');}}
async function test(name,fn){await fn();console.log('PASS '+name);passed++;}
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
insert into auth.users values('${a}'),('${b}');`);
for(const file of ['supabase_profile_schema.sql','supabase_phase1_schema.sql','supabase_phase2_schema.sql','supabase_phase3_schema.sql'])await db.exec(await readFile(new URL('../'+file,import.meta.url),'utf8'));
const index=await scalar("select id from indices where code='NIFTY50'");
await db.query(`insert into profiles(id,username,display_name,ranking_opt_in) values($1,'alpha','Alpha',true)`,[a]);
const period=await as('authenticated',a,()=>scalar(`insert into test_periods(user_id,start_date,duration_sessions) values($1,'2025-01-01',365) returning id`,[a]));
const insert=async(user,day,kind='live')=>as('authenticated',user,()=>scalar(`insert into predictions(user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance${kind?' ,submission_kind':''}) values($1,$2,$3,'Bullish','Flat','Range',95,105${kind?', $4':''}) returning id`,kind?[user,index,day,kind]:[user,index,day]));
const result=day=>({index_id:index,trading_date:day,provider:'upstox',instrument_id:'NSE_INDEX|Nifty 50',timeframe:'1d+15m',fetch_status:'valid',previous_close:100,open:100,high:105,low:95,close:101,actual_bias:'Bullish',actual_opening:'Flat',actual_day_type:'Range',session_open_at:day+'T09:15:00+05:30',session_close_at:day+'T15:30:00+05:30',fetched_at:day+'T16:30:00+05:30',raw_market_data:{data:'legacy-audit'},methodology:{version:'test'}});
for(let i=1;i<=5;i++){const day='2025-01-0'+i;await insert(a,day,null);await as('service_role',null,()=>db.query('select publish_market_session($1::jsonb)',[JSON.stringify(result(day))]));}
const before=(await db.query('select id,score,scored_at,scoring_rule_version,locked_at from predictions order by id')).rows;
assert.equal((await as('authenticated',a,()=>db.query('select * from get_public_ranking()'))).rows.length,1,
  'Audit reproduction: previously all five historical scores entered ranking');
const migration=await readFile(new URL('../supabase_phase3_remediation.sql',import.meta.url),'utf8');
await db.exec(migration);
await test('additive migration is repeatable and preserves predictions, scores, timestamps and 365-session period',async()=>{
 await db.exec(migration);
 assert.deepEqual((await db.query('select id,score,scored_at,scoring_rule_version,locked_at from predictions order by id')).rows,before);
 assert.equal(Number(await scalar('select duration_sessions from test_periods where id=$1',[period])),365);
 assert.equal(await scalar("select count(*)::int from predictions where verification_status='legacy_unverified'"),5);
});
await test('legacy scores remain accessible but never enter verified ranking',async()=>{
 assert.equal((await as('authenticated',a,()=>db.query('select * from get_public_ranking()'))).rows.length,0);
 assert.equal(await as('authenticated',a,()=>scalar("select count(*)::int from predictions where scoring_status='scored'")),5);
});
await test('cutoff is exclusive, microsecond-exact and timezone-invariant; holiday/import/unknown fail closed',async()=>{
 const classify=(received,open,imported=false,isOpen=true)=>scalar('select classify_forecast_receipt($1,$2,$3,$4,$5)',[imported,isOpen,received,open,'2026-10-01T00:00:00Z']);
 assert.equal(await classify('2026-10-05T03:44:59.999999Z','2026-10-05T09:15:00+05:30'),'verified');
 assert.equal(await classify('2026-10-05T03:45:00Z','2026-10-05T09:15:00+05:30'),'late');
 assert.equal(await classify('2026-10-05T03:45:00.000001Z','2026-10-05T09:15:00+05:30'),'late');
 assert.equal(await classify('2026-10-05T00:00:00Z',null,false,false),'non_trading_day');
 assert.equal(await classify('2026-10-05T00:00:00Z',null,false,null),'calendar_unavailable');
 assert.equal(await classify(null,'2026-10-05T09:15:00+05:30'),'calendar_unavailable');
 assert.equal(await classify('2026-10-05T00:00:00Z','2026-10-05T09:15:00+05:30',true),'historical');
});
const future='2098-01-04';
await db.query(`insert into forecast_sessions(index_id,trading_date,exchange_timezone,is_open,opens_at,closes_at,source_reference) values($1,$2,'Asia/Kolkata',true,$3,$4,'fixture calendar')`,[index,future,future+'T09:15:00+05:30',future+'T15:30:00+05:30']);
await test('server insert stamps verified eligibility and associates the active period; duplicates stay unique',async()=>{
 const id=await insert(a,future);
 const row=(await db.query('select * from predictions where id=$1',[id])).rows[0];
 assert.equal(row.verification_status,'verified');assert.equal(row.test_period_id,period);
 assert.equal(new Date(row.locked_at).getTime(),new Date(row.server_received_at).getTime());
 await assert.rejects(insert(a,future),/duplicate key/);
 await as('authenticated',a,()=>assert.rejects(db.query(`insert into predictions(user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance,verification_status) values($1,$2,'2098-01-05','Bullish','Flat','Range',95,105,'verified')`,[a,index]),/permission denied/));
});
await test('future import cannot be verified and its history is retained',async()=>{
 const id=await insert(b,future,'import');
 assert.equal(await scalar('select verification_status from predictions where id=$1',[id]),'historical');
 assert.equal(await as('authenticated',b,()=>scalar('select count(*)::int from predictions')),1);
});
await test('original import grades and lock time are immutable private archives, not verified scores',async()=>{
 const metadata={original_score:{total:73},original_locked_at:'2026-01-01T02:00:00Z'};
 const id=await as('authenticated',a,()=>scalar("insert into predictions(user_id,index_id,trading_date,bias,opening_view,day_type,support,resistance,submission_kind,import_metadata) values($1,$2,'2098-01-08','Bullish','Flat','Range',95,105,'import',$3) returning id",[a,index,JSON.stringify(metadata)]));
 const row=(await as('authenticated',a,()=>db.query('select import_metadata,verification_status,score from predictions where id=$1',[id]))).rows[0];
 assert.deepEqual(row.import_metadata,metadata);assert.equal(row.verification_status,'historical');assert.equal(row.score,null);
 await assert.rejects(db.query("update predictions set import_metadata='{}' where id=$1",[id]),/Locked predictions cannot be edited/);
 assert.equal(await as('authenticated',b,()=>scalar('select count(*)::int from predictions where id=$1',[id])),0);
});
await test('closed holiday and unavailable calendar never become verified',async()=>{
 await db.query("insert into forecast_sessions(index_id,trading_date,exchange_timezone,is_open,source_reference) values($1,'2098-01-05','Asia/Kolkata',false,'fixture holiday')",[index]);
 const holiday=await insert(a,'2098-01-05');const unknown=await insert(a,'2098-01-06');
 assert.equal(await scalar('select verification_status from predictions where id=$1',[holiday]),'non_trading_day');
 assert.equal(await scalar('select verification_status from predictions where id=$1',[unknown]),'calendar_unavailable');
 await as('authenticated',a,()=>assert.rejects(db.query("insert into forecast_sessions(index_id,trading_date,exchange_timezone,is_open,source_reference) values($1,'2098-01-07','Asia/Kolkata',false,'spoofed')",[index]),/permission denied/));
});
await test('late scores remain readable and are excluded from rankings',async()=>{
 for(let i=10;i<15;i++){
  const day='2025-01-'+i;
  await db.query("insert into forecast_sessions(index_id,trading_date,exchange_timezone,is_open,opens_at,closes_at,source_reference) values($1,$2,'Asia/Kolkata',true,$3,$4,'trusted fixture')",[index,day,day+'T09:15:00+05:30',day+'T15:30:00+05:30']);
  // Privileged local fixture simulates a calendar published before opening.
  await db.query("update forecast_sessions set recorded_at=opens_at-interval '1 day' where index_id=$1 and trading_date=$2",[index,day]);
  const id=await insert(a,day);assert.equal(await scalar('select verification_status from predictions where id=$1',[id]),'late');
  // Historical score remains possible; no verified aggregate includes it.
  await db.query("insert into market_sessions(index_id,trading_date,open,high,low,close,actual_bias,actual_opening,actual_day_type) values($1,$2,100,105,95,101,'Bullish','Flat','Range')",[index,day]);
  await as('authenticated',a,()=>db.query('select score_prediction($1)',[id]));
 }
 assert.equal((await as('authenticated',a,()=>db.query('select * from get_public_ranking()'))).rows.length,0);
});
function candles(day){const start=Date.parse(day+'T09:15:00+05:30');return Array.from({length:25},(_,i)=>[new Date(start+i*900000).toISOString(),100,105,95,101,0]);}
const canonical=day=>({...result(day),raw_market_data:{daily:{data:{candles:[[day+'T00:00:00+05:30',100,105,95,101,0]]}},intraday:{data:{candles:candles(day)}}}});
const publish=r=>as('service_role',null,()=>scalar('select publish_market_session($1::jsonb)',[JSON.stringify(r)]));
await test('publication boundary rejects inconsistent close/extrema/incomplete candles before scoring',async()=>{
 for(const field of ['close','high','low','missing']){
  const r=canonical('2025-02-03');
  if(field==='close')r.raw_market_data.intraday.data.candles[24][4]=102;
  if(field==='high')for(const c of r.raw_market_data.intraday.data.candles)c[2]=104;
  if(field==='low')for(const c of r.raw_market_data.intraday.data.candles)c[3]=96;
  if(field==='missing')r.raw_market_data.intraday.data.candles.pop();
  await assert.rejects(publish(r),/reconciliation/i);
 }
 assert.equal(await scalar("select count(*)::int from market_sessions where trading_date='2025-02-03'"),0);
 const accepted=await publish(canonical('2025-02-03'));
 assert.equal((await publish({...canonical('2025-02-03'),close:104})).session_id,accepted.session_id);
});
await test('decimal OHLC tolerance accepts exactly 0.05 and rejects greater differences',async()=>{
 const at=canonical('2025-02-04');at.raw_market_data.intraday.data.candles[24][4]=101.05;
 assert.ok((await publish(at)).session_id);
 const over=canonical('2025-02-05');over.raw_market_data.intraday.data.candles[24][4]=101.05001;
 await assert.rejects(publish(over),/Inconsistent OHLC/);
});
await test('unchecked publisher and quarantine audits are inaccessible to users; stale leases cannot quarantine',async()=>{
 for(const role of ['anon','authenticated'])await as(role,a,async()=>{
  await assert.rejects(db.query('select publish_market_session_unchecked($1::jsonb)',['{}']),/permission denied/);
  await assert.rejects(db.query('select * from market_data_quarantine'),/permission denied/);
 });
 const job=await scalar("insert into market_fetch_jobs(provider,index_id,trading_date,status,lease_token) values('upstox',$1,'2025-03-01','running',gen_random_uuid()) returning id",[index]);
 const lease=await scalar('select lease_token from market_fetch_jobs where id=$1',[job]);
 const quarantine=(token)=>as('service_role',null,()=>scalar("select quarantine_market_job($1,$2,'INCONSISTENT_CLOSE',$3)",[job,token,JSON.stringify({raw_market_data:{fixture:true}})]));
 assert.equal(await quarantine('00000000-0000-0000-0000-000000000000'),false);
 assert.equal(await quarantine(lease),true);assert.equal(await quarantine(lease),false);
 assert.equal(await scalar('select status from market_fetch_jobs where id=$1',[job]),'quarantined');
 assert.equal(await scalar('select count(*)::int from market_data_quarantine'),1);
 await as('service_role',null,()=>db.query('select retry_market_job($1)',[job]));
 assert.equal(await scalar('select status from market_fetch_jobs where id=$1',[job]),'retry');
 assert.equal(await scalar('select count(*)::int from market_data_quarantine'),1);
});
await test('verified scored forecasts still enter the opt-in ranking with unchanged scoring weights',async()=>{
 // Privileged synthetic outcome fixtures isolate aggregation; actual publication
 // of future outcomes is separately rejected by the canonical RPC tests.
 for(let day=1;day<=5;day++){
  const date='2098-02-0'+day;
  await as('service_role',null,()=>db.query('select record_forecast_session($1,$2,$3)',[index,date,JSON.stringify({is_open:true,opens_at:date+'T09:15:00+05:30',closes_at:date+'T15:30:00+05:30'})]));
  const id=await insert(a,date);
  assert.equal(await scalar('select verification_status from predictions where id=$1',[id]),'verified');
  await db.query("insert into market_sessions(index_id,trading_date,open,high,low,close,actual_bias,actual_opening,actual_day_type) values($1,$2,100,105,95,101,'Bullish','Flat','Range')",[index,date]);
  await as('authenticated',a,()=>db.query('select score_prediction($1)',[id]));
 }
 const rows=(await as('authenticated',a,()=>db.query('select * from get_public_ranking()'))).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].username,'alpha');assert.equal(Number(rows[0].completed_predictions),5);assert.equal(Number(rows[0].average_score),100);
 await as('authenticated',a,()=>assert.rejects(db.query('select record_forecast_session($1,$2,$3)',[index,'2098-03-01',JSON.stringify({is_open:false})]),/permission denied/));
});
console.log(`${passed} remediation PostgreSQL integration checks passed`);await db.close();
