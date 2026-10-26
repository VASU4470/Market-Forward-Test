(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  const KEY = 'marketForwardTestV2';
  let running = null;
  let context = null;
  function localId() {
    if (typeof crypto.randomUUID==='function') return crypto.randomUUID();
    // LAN/manual HTTP previews may lack randomUUID. This is an idempotency
    // identifier, never an authentication credential.
    return 'local-'+Date.now()+'-'+Array.from(crypto.getRandomValues(new Uint32Array(4))).map(n=>n.toString(16)).join('-');
  }
  const read = () => JSON.parse(localStorage.getItem(KEY) || '{"profiles":{}}');
  const write = store => {
    localStorage.setItem(KEY, JSON.stringify(store));
    window.dispatchEvent(new Event('mft:sync-updated'));
  };
  const complete = row => row && typeof row.id === 'string' && ['index_id','trading_date','bias','opening_view','day_type'].every(k=>typeof row[k]==='string') &&
    ['support','resistance'].every(k=>row[k]!==null && row[k]!=='' && typeof row[k]!=='boolean' && Number.isFinite(Number(row[k])));
  const canonical = value => value && typeof value==='object' ? (Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))) : value;
  const samePrediction = (row, body, userId) => complete(row) && (!userId || row.user_id===userId) &&
    ['index_id','trading_date','bias','opening_view','day_type'].every(k => row[k] === body[k]) &&
    ['support','resistance'].every(k => Number.isFinite(Number(row[k])) && Number(row[k]) === body[k]) &&
    (row.test_period_id || null) === (body.test_period_id || null) &&
    (!body.import_metadata || JSON.stringify(canonical(row.import_metadata))===JSON.stringify(canonical(body.import_metadata)));
  const mapped = row => ({
    cloudId:row.id, cloudSync:'synced', date:row.trading_date,indexId:row.index_id,
    bias:row.bias,opening:row.opening_view,dayType:row.day_type,support:row.support,resistance:row.resistance,
    lockedAt:row.import_metadata?.original_locked_at || row.locked_at,originalLocalScore:row.import_metadata?.original_score || null,serverReceivedAt:row.server_received_at,verificationStatus:row.verification_status || 'legacy_unverified',
    submissionKind:row.submission_kind, testPeriodCloudId:row.test_period_id,
    actual:row.import_metadata?.original_actual || null, score:row.scoring_status==='scored' ? {total:Number(row.score),source:'server',
      rule_version:row.scoring_rule_version,detail:{...(row.score_details||{}),dayType:row.score_details?.day_type ?? 0}} : null
  });
  function mergePredictions(local, remote) {
    const result = [...local];
    for (const row of remote || []) {
      if (!complete(row)) continue;
      const at = result.findIndex(p => p.cloudId === row.id && p.cloudSync === 'synced');
      if (at < 0) {
        // Do not replace an unresolved local record sharing a date/index.
        if (result.some(p => p.cloudSync !== 'synced' && p.date===row.trading_date && p.indexId===row.index_id)) continue;
        const incoming=mapped(row);
        if(incoming.originalLocalScore && incoming.verificationStatus!=='verified') {incoming.serverScore=incoming.score;incoming.score=incoming.originalLocalScore;}
        result.push(incoming);
      } else {
        const prior=result[at], incoming=mapped(row);
        result[at]={...prior,...incoming,lockedAt:prior.lockedAt || incoming.lockedAt,
          actual:prior.actual || incoming.actual,originalLocalScore:prior.originalLocalScore || incoming.originalLocalScore,
          serverScore:incoming.score || prior.serverScore,
          score:(prior.originalLocalScore || incoming.originalLocalScore) && incoming.verificationStatus!=='verified' ?
            (prior.originalLocalScore || incoming.originalLocalScore) : incoming.score || prior.score};
      }
    }
    return result;
  }
  function profileFor(userId, profileKey) {
    const store=read(), profile=store.profiles?.[profileKey];
    if (!profile || store.activeProfile!==profileKey || profile.supabaseUserId!==userId) throw new Error('Account changed; synchronization paused.');
    return {store,profile};
  }
  function mutate(userId, profileKey, fn) {
    const {store,profile}=profileFor(userId,profileKey); fn(profile.state);write(store);
  }
  function pending(row,error) {
    row.cloudSync='pending';row.syncAttempts=(row.syncAttempts||0)+1;
    row.nextRetryAt=Date.now()+Math.min(300000,5000*2**Math.min(row.syncAttempts-1,6));
    row.syncError=error.code || (error.status ? 'HTTP_'+error.status : 'UPLOAD_UNAVAILABLE');
  }
  async function reconcile(userId,indexId,force) {
    const profileKey=read().activeProfile;
    let {store,profile}=profileFor(userId,profileKey);
    profile.state=profile.state||{predictions:[]};
    profile.state.predictions=profile.state.predictions||[];
    profile.state.forwardTests=profile.state.forwardTests||[];
    // Durable IDs and provenance are saved before the first request.
    for (const test of profile.state.forwardTests) {
      test.id=test.id||test.cloudId||localId();
      const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      if(test.status==='active' && test.startDate>today) test.status='scheduled';
    }
    for (const p of profile.state.predictions) {
      p.clientId=p.clientId||localId();
      if (!p.cloudOrigin) p.cloudOrigin='import';
      if (p.score && !p.score.rule_version && p.score.source!=='server' && !p.originalLocalScore) p.originalLocalScore=JSON.parse(JSON.stringify(p.score));
      if (!p.testPeriodId && p.lockedAt) {
        const candidates=profile.state.forwardTests.filter(t => p.date>=t.startDate &&
          new Date(p.lockedAt)>=new Date(t.startedAt) &&
          (!(t.stoppedAt||t.completedAt) || new Date(p.lockedAt)<=new Date(t.stoppedAt||t.completedAt)));
        if (candidates.length===1) p.testPeriodId=candidates[0].id;
      }
    }
    write(store);
    const periods=[...profile.state.forwardTests];
    for (const period of periods) {
      const {profile:latest}=profileFor(userId,profileKey);
      const item=latest.state.forwardTests.find(t=>t.id===period.id);
      if (item.cloudId && item.cloudStatus===item.status) continue;
      if (!force && item.nextRetryAt>Date.now()) return {pending:true};
      const body={start_date:item.startDate,duration_sessions:item.targetSessions,client_key:item.id,
        status:item.status,end_date:item.endDate || ((item.stoppedAt||item.completedAt) ?
          new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.stoppedAt||item.completedAt)) : null),
        completed_at:item.completedAt||null};
      try {
        let row;
        if (item.cloudId) row=await root.testPeriods.update(item.cloudId,{status:item.status,end_date:body.end_date,completed_at:body.completed_at},userId);
        else {
          try { row=await root.testPeriods.create(body,userId); }
          catch(error) {
            if (error.status!==409) throw error;
            row=(await root.testPeriods.list(userId)).find(r=>r.client_key===item.id && r.start_date===body.start_date && Number(r.duration_sessions)===body.duration_sessions && r.status===body.status);
            if (!row) throw error;
          }
        }
        if (!row?.id || row.status!==item.status) throw new Error('Test-period acknowledgement incomplete.');
        mutate(userId,profileKey,state=>{
          const current=state.forwardTests.find(t=>t.id===item.id);
          Object.assign(current,{cloudId:row.id,cloudStatus:row.status,
            cloudSync:current.status===row.status?'synced':'pending',nextRetryAt:0,syncError:null});
        });
      } catch(error) {
        mutate(userId,profileKey,state=>pending(state.forwardTests.find(t=>t.id===item.id),error));
        return {pending:true}; // In particular: do NOT open a replacement after failed closure.
      }
    }
    if (profileFor(userId,profileKey).profile.state.forwardTests.some(t=>!t.cloudId || t.status!==t.cloudStatus)) return {pending:true};
    const predictions=[...profileFor(userId,profileKey).profile.state.predictions];
    let migrated=0;
    for (const snapshot of predictions) {
      const {profile:latest}=profileFor(userId,profileKey);
      const p=latest.state.predictions.find(p=>p.clientId===snapshot.clientId);
      if (p.cloudSync==='synced' && p.cloudId) continue;
      if (!force && p.nextRetryAt>Date.now()) continue;
      const period=p.testPeriodId && latest.state.forwardTests.find(t=>t.id===p.testPeriodId);
      const body={index_id:p.indexId==='local-nifty50' ? indexId : (p.indexId||indexId),trading_date:p.date,
        bias:p.bias,opening_view:p.opening,day_type:p.dayType,support:Number(p.support),resistance:Number(p.resistance),
        submission_kind:p.cloudOrigin==='live'?'live':'import'};
      if(body.submission_kind==='import') body.import_metadata={original_locked_at:p.lockedAt||null,
        original_score:p.originalLocalScore || p.score || null,original_actual:p.actual || null,client_id:p.clientId};
      if (p.testPeriodId && !period?.cloudId) continue;
      if (period) body.test_period_id=period.cloudId;
      else if (p.testPeriodCloudId) body.test_period_id=p.testPeriodCloudId;
      try {
        let row;
        try { row=await root.predictions.createPrediction(body,userId); }
        catch(error) {
          if (error.status!==409) throw error;
          row=(await root.predictions.getMyPredictions('',userId)).find(r=>samePrediction(r,body,userId));
          if (!row) throw error;
        }
        if (!samePrediction(row,body,userId)) throw new Error('Prediction acknowledgement incomplete.');
        mutate(userId,profileKey,state=>Object.assign(state.predictions.find(p=>p.clientId===snapshot.clientId),
          {cloudId:row.id,indexId:row.index_id,cloudSync:'synced',nextRetryAt:0,syncError:null,
            verificationStatus:row.verification_status||'legacy_unverified'}));
        migrated++;
      } catch(error) { mutate(userId,profileKey,state=>pending(state.predictions.find(p=>p.clientId===snapshot.clientId),error)); }
    }
    return {migrated,pending:profileFor(userId,profileKey).profile.state.predictions.some(p=>p.cloudSync!=='synced')};
  }
  root.predictions={
    localId,samePrediction,mergePredictions,
    createPrediction:async (prediction,userId)=>(await root.api.request('/api/v1/predictions',{method:'POST',body:prediction,expectedUserId:userId})).prediction,
    scorePrediction:async id=>(await root.api.request(`/api/v1/predictions/${encodeURIComponent(id)}/score`,{method:'POST',body:{}})).prediction,
    getMyPredictions:async (indexId='',userId)=>{
      const suffix=indexId?`?index_id=${encodeURIComponent(indexId)}`:'';
      const rows=(await root.api.request(`/api/v1/predictions/me${suffix}`,{expectedUserId:userId})).predictions;
      if (!Array.isArray(rows)) throw new Error('Incomplete prediction response.');
      return rows;
    },
    migrateLocalPredictions(userId,indexId,force=true) {
      context={userId,indexId};
      if (running) return running;
      running=reconcile(userId,indexId,force).finally(()=>{running=null;});return running;
    },
    async mergeRemote(userId,remote,periods) {
      const key=read().activeProfile;
      mutate(userId,key,state=>{
        state.predictions=mergePredictions(state.predictions||[],remote);
        for (const row of periods||[]) {
          if (!row?.id) continue;
          const prior=(state.forwardTests||[]).find(t=>t.cloudId===row.id);
          if (prior) { if (prior.cloudSync==='synced') Object.assign(prior,{cloudStatus:row.status,status:row.status}); }
          else (state.forwardTests=state.forwardTests||[]).push({id:row.client_key||row.id,cloudId:row.id,cloudSync:'synced',cloudStatus:row.status,
            startDate:row.start_date,targetSessions:row.duration_sessions,startedAt:row.created_at,status:row.status,completedAt:row.completed_at,stoppedAt:row.status==='stopped'?row.end_date:null});
        }
      });
    }
  };
  const retry=()=>{if(context) root.predictions.migrateLocalPredictions(context.userId,context.indexId,false).catch(()=>{});};
  window.addEventListener('online',()=>{if(context) root.predictions.migrateLocalPredictions(context.userId,context.indexId,true).catch(()=>{});});
  setInterval(retry,30000);
})();
