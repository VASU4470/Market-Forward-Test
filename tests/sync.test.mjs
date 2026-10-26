import {test} from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
const source=name=>readFileSync(new URL('../services/'+name,import.meta.url),'utf8');
const prediction={date:'2026-10-05',indexId:'index-a',bias:'Bullish',opening:'Flat',dayType:'Range',support:95,resistance:105,lockedAt:'2026-10-05T02:00:00Z',score:{total:73,detail:{}}};
function harness(records=[prediction],periods=[]){
 const storage=new Map([['marketForwardTestV2',JSON.stringify({activeProfile:'alpha',profiles:{alpha:{supabaseUserId:'user-a',state:{predictions:structuredClone(records),forwardTests:structuredClone(periods)}}}})],['mftCloudMigrationV1:user-a','complete']]);
 const events={};const timers=[];const calls=[];let action=async(path,o)=>{
  if(path==='/api/v1/predictions' && o.method==='POST')return {prediction:{...o.body,user_id:'user-a',id:'p1',test_period_id:o.body.test_period_id||null,verification_status:'historical'}};
  if(path.includes('predictions/me'))return {predictions:[]};
  if(path==='/api/v1/test-periods' && o.method==='POST')return {test_period:{...o.body,id:'period-'+o.body.client_key}};
  if(path==='/api/v1/test-periods')return {test_periods:[]};
  if(path.startsWith('/api/v1/test-periods/'))return {test_period:{...o.body,id:path.split('/').pop()}};
  throw new Error('Unexpected request '+path);
 };
 const ctx={localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},crypto:webcrypto,Date,Number,console,Event:class{constructor(type){this.type=type;}},setInterval:fn=>timers.push(fn)};
 ctx.window=ctx;ctx.addEventListener=(name,fn)=>events[name]=fn;ctx.dispatchEvent=e=>events[e.type]?.(e);
 ctx.PiZeroServices={api:{request:async(path,o={})=>{calls.push([path,o]);return action(path,o);}}};
 vm.createContext(ctx);vm.runInContext(source('test-period-service.js'),ctx);vm.runInContext(source('prediction-service.js'),ctx);
 return {service:ctx.PiZeroServices.predictions,ctx,storage,calls,events,timers,setAction:fn=>action=fn,
 state:()=>JSON.parse(storage.get('marketForwardTestV2')).profiles.alpha.state};
}
const fail=status=>Object.assign(new Error('fixture failure'),{status});
test('HTTP 400 never marks migration complete or loses local score; old complete marker is ignored',async()=>{
 const h=harness();h.setAction(async()=>{throw fail(400);});
 const out=await h.service.migrateLocalPredictions('user-a','index-a');assert.equal(out.pending,true);
 assert.equal(h.state().predictions.length,1);assert.equal(h.state().predictions[0].cloudSync,'pending');assert.equal(h.state().predictions[0].score.total,73);
 assert.equal(h.state().predictions[0].syncAttempts,1);
});
test('409 only acknowledges identical server forecast and period, not merely a matching date',async()=>{
 for(const different of [false,true]){
  const h=harness();h.setAction(async(path,o)=>{if(o.method==='POST')throw fail(409);return {predictions:[{import_metadata:h.calls.find(c=>c[1].method==='POST')[1].body.import_metadata,id:'server',user_id:'user-a',index_id:'index-a',trading_date:prediction.date,bias:different?'Bearish':'Bullish',opening_view:'Flat',day_type:'Range',support:95,resistance:105,test_period_id:null}]};});
  await h.service.migrateLocalPredictions('user-a','index-a');
  assert.equal(h.state().predictions[0].cloudSync,different?'pending':'synced');
 }
});
test('200 with missing representation is not acknowledgement',async()=>{
 const h=harness();h.setAction(async()=>({prediction:{id:'server'}}));await h.service.migrateLocalPredictions('user-a','index-a');
 assert.equal(h.state().predictions[0].cloudSync,'pending');
});
test('empty/partial remote snapshots preserve unsynchronized variants and grades',async()=>{
 const h=harness();await h.service.mergeRemote('user-a',[],[]);await h.service.mergeRemote('user-a',[{id:'x',trading_date:prediction.date,index_id:'index-a'}],[]);
 assert.equal(h.state().predictions.length,1);assert.equal(h.state().predictions[0].score.total,73);
});
test('period closure failure persists; no replacement POST occurs until closure acknowledged',async()=>{
 const periods=[{id:'old',cloudId:'server-old',cloudStatus:'active',startDate:'2026-10-01',targetSessions:365,status:'stopped',stoppedAt:'2026-10-05T00:00:00Z'},
 {id:'new',startDate:'2026-10-05',targetSessions:1,status:'active'}];
 const h=harness([],periods);h.setAction(async()=>{throw fail(503);});
 await h.service.migrateLocalPredictions('user-a','index-a');assert.equal(h.calls.length,1);assert.equal(h.calls[0][1].method,'PATCH');assert.equal(h.state().forwardTests.length,2);
 h.calls.length=0;h.setAction(async(path,o)=>o.method==='PATCH'?{test_period:{id:'server-old',status:'stopped'}}:{test_period:{id:'server-new',status:'active'}});
 await h.service.migrateLocalPredictions('user-a','index-a');assert.deepEqual(h.calls.map(c=>c[1].method),['PATCH','POST']);assert.equal(h.state().forwardTests[1].cloudId,'server-new');
});
test('period creation timeout is reconciled by durable client key before prediction upload',async()=>{
 const h=harness([{...prediction,testPeriodId:'test-1'}],[{id:'test-1',status:'active',startDate:'2026-10-01',targetSessions:365}]);
 h.setAction(async(path,o)=>{
  if(path==='/api/v1/test-periods' && o.method==='POST')throw fail(409);
  if(path==='/api/v1/test-periods')return {test_periods:[{id:'period1',client_key:'test-1',start_date:'2026-10-01',duration_sessions:365,status:'active'}]};
  return {prediction:{id:'p1',user_id:'user-a',...o.body}};
 });
 await h.service.migrateLocalPredictions('user-a','index-a');
 assert.equal(h.calls.at(-1)[1].body.test_period_id,'period1');assert.equal(h.state().predictions[0].cloudSync,'synced');
});
test('retry state survives a new service instance and a failed HTTP response followed by success',async()=>{
 const h=harness();h.setAction(async()=>{throw fail(502);});await h.service.migrateLocalPredictions('user-a','index-a');
 vm.runInContext(source('prediction-service.js'),h.ctx);
 h.setAction(async(path,o)=>({prediction:{id:'p1',user_id:'user-a',...o.body}}));
 await h.ctx.PiZeroServices.predictions.migrateLocalPredictions('user-a','index-a');
 assert.equal(h.state().predictions[0].cloudId,'p1');assert.equal(h.state().predictions[0].score.total,73);
});
test('response racing a new local record merges into fresh storage, never an old snapshot',async()=>{
 const h=harness();h.setAction(async(path,o)=>{const store=JSON.parse(h.storage.get('marketForwardTestV2'));store.profiles.alpha.state.predictions.push({...prediction,date:'2026-10-06',clientId:'new'});h.storage.set('marketForwardTestV2',JSON.stringify(store));return {prediction:{id:'p1',user_id:'user-a',...o.body}};});
 await h.service.migrateLocalPredictions('user-a','index-a');assert.equal(h.state().predictions.length,2);assert.equal(h.state().predictions[1].clientId,'new');
});
test('account changes reject synchronization before a network request',async()=>{
 const h=harness();await assert.rejects(h.service.migrateLocalPredictions('user-b','index-a'),/Account changed/);assert.equal(h.calls.length,0);
});
test('API binds upload to the expected Supabase session even after an account switch',async()=>{
 const h=harness();h.ctx.__MFT_SUPABASE_CLIENT={auth:{getSession:async()=>({data:{session:{access_token:'fake',user:{id:'other-user'}}}})}};
 h.ctx.fetch=()=>{throw new Error('Network must not be reached');};vm.runInContext(source('api-client.js'),h.ctx);
 await assert.rejects(h.ctx.PiZeroServices.api.request('/api/v1/predictions',{method:'POST',body:{},expectedUserId:'user-a'}),/Account changed/);
});

test('period end date uses the exchange day at the IST midnight boundary',async()=>{
 const h=harness([],[{id:'old',cloudId:'server-old',cloudStatus:'active',status:'stopped',startDate:'2026-10-01',targetSessions:365,stoppedAt:'2026-10-05T19:00:00Z'}]);
 h.setAction(async(path,o)=>({test_period:{id:'server-old',...o.body}}));
 await h.service.migrateLocalPredictions('user-a','index-a');
 assert.equal(h.calls[0][1].body.end_date,'2026-10-06');
});

test('same date and forecast from another owner or period never acknowledge a 409',async()=>{
 for(const changes of [{user_id:'other-user'},{test_period_id:'other-period'}]){
  const h=harness();h.setAction(async(path,o)=>{if(o.method==='POST')throw fail(409);return {predictions:[{id:'p1',user_id:'user-a',index_id:'index-a',trading_date:prediction.date,bias:'Bullish',opening_view:'Flat',day_type:'Range',support:95,resistance:105,test_period_id:null,...changes}]};});
  await h.service.migrateLocalPredictions('user-a','index-a');assert.equal(h.state().predictions[0].cloudSync,'pending');
 }
});
test('a late period acknowledgement cannot undo a locally requested closure',async()=>{
 const h=harness([],[{id:'old',status:'active',startDate:'2026-10-01',targetSessions:365}]);
 h.setAction(async(path,o)=>{
  const store=JSON.parse(h.storage.get('marketForwardTestV2'));store.profiles.alpha.state.forwardTests[0].status='stopped';h.storage.set('marketForwardTestV2',JSON.stringify(store));
  return {test_period:{id:'period-old',status:'active'}};
 });
 await h.service.migrateLocalPredictions('user-a','index-a');
 await h.service.mergeRemote('user-a',[],[{id:'period-old',status:'active'}]);
 assert.equal(h.state().forwardTests[0].status,'stopped');assert.equal(h.state().forwardTests[0].cloudSync,'pending');
});
test('historical hydration retains original manual score and time separately from server grade',async()=>{
 const h=harness([]);
 const row={id:'p1',user_id:'user-a',index_id:'index-a',trading_date:prediction.date,bias:'Bullish',opening_view:'Flat',day_type:'Range',support:95,resistance:105,
  locked_at:'2026-10-26T00:00:00Z',verification_status:'historical',scoring_status:'scored',score:100,scoring_rule_version:'p2-v1',
  import_metadata:{original_score:prediction.score,original_locked_at:prediction.lockedAt,original_actual:{low:95,high:105}}};
 await h.service.mergeRemote('user-a',[row],[]);
 const p=h.state().predictions[0];assert.equal(p.score.total,73);assert.equal(p.originalLocalScore.total,73);assert.equal(p.serverScore.total,100);assert.equal(p.lockedAt,prediction.lockedAt);
});
