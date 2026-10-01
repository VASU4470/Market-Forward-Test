const ROOT_KEY = 'marketForwardTestV2';
const LEGACY_KEY = 'marketForwardTestV1';
const THEME_KEY = 'marketForwardTestTheme';
const INDIA_TZ = 'Asia/Kolkata';

const $ = id => document.getElementById(id);

function currentTheme(){
  try { return localStorage.getItem(THEME_KEY) || document.documentElement.dataset.theme || 'dark'; }
  catch (_) { return document.documentElement.dataset.theme || 'dark'; }
}

function applyTheme(theme){
  const next = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', next === 'light' ? '#f7f3ee' : '#120f17');
  document.querySelectorAll('.theme-toggle').forEach(btn => {
    const icon = btn.querySelector('.theme-toggle-icon');
    const label = btn.querySelector('.theme-toggle-label');
    if (icon) icon.textContent = next === 'dark' ? '☀' : '◐';
    if (label) label.textContent = next === 'dark' ? 'Light' : 'Dark';
    btn.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
    btn.setAttribute('title', `Switch to ${next === 'dark' ? 'light' : 'dark'} theme`);
  });
}

function toggleTheme(){
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!document.startViewTransition || reduceMotion) {
    applyTheme(next);
    return;
  }

  const root = document.documentElement;
  root.dataset.themeTransition = next;
  root.classList.add('theme-switching');

  const transition = document.startViewTransition(() => applyTheme(next));
  transition.finished.finally(() => {
    delete root.dataset.themeTransition;
    root.classList.remove('theme-switching');
  });
}

function indiaDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: INDIA_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}
const dateKey = indiaDateKey();

let root = JSON.parse(localStorage.getItem(ROOT_KEY) || '{"profiles":{},"activeProfile":null}');
if (!root.profiles) root.profiles = {};

let historyFilter = 'all';
let draft = { bias:null, opening:null, dayType:null, support:'', resistance:'' };
let pendingPrediction = null;
let indices = [];
let selectedIndexId = 'local-nifty50';
let resultSelection = null;
let serverDashboardState = {status:'idle', statistics:null, progress:null, ranking:[]};

function saveRoot(){ localStorage.setItem(ROOT_KEY, JSON.stringify(root)); }
function activeProfile(){ return root.activeProfile ? root.profiles[root.activeProfile] : null; }
function activeState(){ return activeProfile()?.state || null; }
function current(){ return activeState()?.predictions.find(p => p.date === dateKey && (p.indexId || 'local-nifty50') === selectedIndexId); }
function selectedResultPrediction(){
  const state = activeState();
  if (!state) return null;
  if (resultSelection) {
    return state.predictions.find(p => p.date === resultSelection.date && (p.indexId || 'local-nifty50') === resultSelection.indexId) || null;
  }
  return current();
}
function selectedIndex(){ return indices.find(item => item.id === selectedIndexId) || indices[0] || {id:'local-nifty50', display_name:'NIFTY 50'}; }

function profileIdFromEmail(email){
  return email.trim().toLowerCase();
}

function ensureProfileState(profile){
  if (!profile.state) profile.state = {predictions:[], language:'en'};
  if (!profile.state.predictions) profile.state.predictions = [];
  if (!profile.state.language) profile.state.language = 'en';
  if (!Array.isArray(profile.state.forwardTests)) profile.state.forwardTests = [];
}

function activeForwardTest(){
  const tests = activeState()?.forwardTests || [];
  return [...tests].reverse().find(test => test.status === 'active') || null;
}

function forwardTestSessions(test){
  if (!test) return 0;
  const endedAt = test.stoppedAt || test.completedAt;
  const days = new Set(activeState().predictions
    .filter(p => p.date >= test.startDate && p.date <= dateKey && p.lockedAt && new Date(p.lockedAt) >= new Date(test.startedAt) && (!endedAt || new Date(p.lockedAt) <= new Date(endedAt)))
    .map(p => p.date));
  return days.size;
}

function displayDateKey(value){
  const d = new Date(`${value}T12:00:00+05:30`);
  return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:INDIA_TZ}).format(d);
}

function renderForwardTest(){
  const panel = $('forwardTestPanel');
  if (!panel || !activeState()) return;
  const tests = activeState().forwardTests;
  const test = activeForwardTest();
  if (test) {
    const count = forwardTestSessions(test);
    const done = count >= test.targetSessions;
    const scheduled = test.startDate > dateKey;
    if (done && test.status !== 'completed') {
      test.status = 'completed'; test.completedAt = new Date().toISOString();
      if (test.cloudId && window.PiZeroServices?.testPeriods) {
        window.PiZeroServices.testPeriods.update(test.cloudId, {status:'completed', end_date:dateKey, completed_at:test.completedAt}).catch(() => {});
      }
    }
    panel.innerHTML = `<div class="forward-test-head"><div><span class="section-kicker">YOUR FORWARD TEST</span><h2 id="forwardTestTitle">${done ? 'Test complete' : scheduled ? 'Test scheduled' : 'Test in progress'}</h2><p>${test.targetSessions} market sessions · starts ${displayDateKey(test.startDate)}</p></div><span class="panel-note">${done ? 'COMPLETE' : scheduled ? 'SCHEDULED' : 'ACTIVE'}</span></div>
      <div class="forward-test-status"><strong>${count} / ${test.targetSessions}</strong><div class="forward-test-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${test.targetSessions}" aria-valuenow="${Math.min(count,test.targetSessions)}"><span style="width:${Math.min(100,Math.round(count/test.targetSessions*100))}%"></span></div><span class="forward-test-copy">${done ? 'Recorded sessions reached your goal.' : scheduled ? `Begins ${displayDateKey(test.startDate)}.` : 'Unique market dates with a prediction.'}</span></div>
      <div class="forward-test-actions"><button id="newForwardTest" class="secondary-btn" type="button">${done ? 'Start another test' : 'Set up another test'}</button><span class="forward-test-copy">Your earlier test record and predictions stay in history.</span></div>`;
  } else {
    const previous = [...tests].reverse().find(item => item.status === 'completed');
    const history = tests.filter(item => item.status !== 'active').slice().reverse();
    panel.innerHTML = `<div class="forward-test-head"><div><span class="section-kicker">YOUR FORWARD TEST</span><h2 id="forwardTestTitle">${previous ? 'Choose your next test' : 'Choose when to begin'}</h2><p>Pick a start date and how many market sessions you want to track.</p></div></div>
      <form id="forwardTestForm" class="forward-test-form"><label>Start date<input id="forwardTestStart" type="date" min="${dateKey}" value="${dateKey}" required></label><label>Market sessions<input id="forwardTestTarget" type="number" min="1" max="365" step="1" value="30" required></label><button class="primary-btn" type="submit">${previous ? 'START NEW TEST' : 'START MY TEST'} <span>→</span></button></form>
      <p class="forward-test-copy" style="margin-top:10px">One session is counted per calendar market date when you record at least one prediction. The default is 30; choose any number from 1 to 365.</p>
      ${history.length ? `<div class="forward-test-history"><strong>Previous tests</strong>${history.map(item => `<div><span>${item.status === 'completed' ? 'Completed' : 'Stopped'} · ${item.targetSessions} sessions · started ${displayDateKey(item.startDate)}</span><b>${forwardTestSessions(item)} / ${item.targetSessions}</b></div>`).join('')}</div>` : ''}`;
  }
}

document.addEventListener('submit', async event => {
  if (event.target.id !== 'forwardTestForm') return;
  event.preventDefault();
  const startDate = $('forwardTestStart').value;
  const targetSessions = Number($('forwardTestTarget').value);
  if (!startDate || startDate < dateKey || !Number.isInteger(targetSessions) || targetSessions < 1 || targetSessions > 365) {
    alert('Choose today or a future start date and a whole number of sessions from 1 to 365.'); return;
  }
  const tests = activeState().forwardTests;
  if (activeForwardTest() && !confirm('Start a new test? The current test will be marked stopped, and its record will be kept.')) return;
  const previous = activeForwardTest();
  if (previous) {
    previous.status = 'stopped'; previous.stoppedAt = new Date().toISOString();
    if (previous.cloudId && window.PiZeroServices?.testPeriods) {
      window.PiZeroServices.testPeriods.update(previous.cloudId, {status:'stopped', end_date:dateKey}).catch(() => {});
    }
  }
  const test = {id:`test-${Date.now()}`, startDate, targetSessions, startedAt:new Date().toISOString(), status:'active'};
  tests.push(test);
  if (window.__MFT_SUPABASE_CLIENT && window.PiZeroServices?.testPeriods) {
    try {
      const cloud = await window.PiZeroServices.testPeriods.create({start_date:startDate, duration_sessions:targetSessions});
      test.cloudId = cloud?.id || null;
    } catch (_) { test.cloudSync = 'pending'; }
  }
  saveRoot(); renderAll();
});

document.addEventListener('click', event => {
  if (!event.target.closest('#newForwardTest')) return;
  const test = activeForwardTest();
  if (test && !confirm('Set up another test? The current test will be marked stopped, and its record will be kept.')) return;
  if (test) {
    test.status = 'stopped'; test.stoppedAt = new Date().toISOString();
    if (test.cloudId && window.PiZeroServices?.testPeriods) {
      window.PiZeroServices.testPeriods.update(test.cloudId, {status:'stopped', end_date:dateKey}).catch(() => {});
    }
  }
  saveRoot(); renderAll();
});

function migrateLegacyIfNeeded(profile){
  const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
  if (!legacy || profile.migratedLegacy) return;
  if (Array.isArray(legacy.predictions) && !profile.state.predictions.length) {
    profile.state.predictions = legacy.predictions;
  }
  if (legacy.language) profile.state.language = legacy.language;
  profile.migratedLegacy = true;
}

function formatDate(d = new Date()){
  const state = activeState() || {language:'en'};
  return new Intl.DateTimeFormat(state.language === 'ta' ? 'ta-IN' : 'en-IN', {
    weekday:'long', day:'numeric', month:'long', year:'numeric', timeZone:INDIA_TZ
  }).format(d);
}

const i18n = {
  en: {
    todayLabel:'TODAY · NIFTY', intro:'Record your pre-market view and lock it before the session.',
    bias:'What is your Nifty bias?', opening:'Expected opening?', day:'Expected day type?', levels:'Key levels',
    support:'Support', resistance:'Resistance', lock:'🔒 LOCK MY VIEW',
    fine:'Once locked, today\'s prediction cannot be edited.', result:'Result', history:'History', score:'My Score', today:'Today',
    lockedAt:'Prediction locked at', dialogTitle:'Lock today\'s view?', dialogText:'After locking, you cannot change this prediction.',
    cancel:'Cancel', confirm:'LOCK IT'
  },
  ta: {
    todayLabel:'இன்று · NIFTY', intro:'மார்க்கெட் தொடங்குவதற்கு முன் உங்கள் பார்வையை பதிவு செய்து lock செய்யுங்கள்.',
    bias:'இன்றைய Nifty bias என்ன?', opening:'Opening எப்படி இருக்கும்?', day:'Day type என்ன?', levels:'முக்கிய levels',
    support:'Support', resistance:'Resistance', lock:'🔒 என் VIEW-ஐ LOCK செய்',
    fine:'Lock செய்த பிறகு இன்றைய prediction-ஐ மாற்ற முடியாது.', result:'முடிவு', history:'வரலாறு', score:'என் Score', today:'இன்று',
    lockedAt:'Prediction lock செய்த நேரம்', dialogTitle:'இன்றைய view-ஐ lock செய்யவா?', dialogText:'Lock செய்த பிறகு இந்த prediction-ஐ மாற்ற முடியாது.',
    cancel:'Cancel', confirm:'LOCK செய்'
  }
};

function setLanguage(){
  const state = activeState(); if (!state) return;
  const t = i18n[state.language];
  $('todayLabel').textContent = `${t.todayLabel.split('·')[0].trim()} · ${selectedIndex().display_name}`;
  $('todayIntro').textContent = t.intro;
  $('biasQuestion').textContent = t.bias;
  $('openQuestion').textContent = t.opening;
  $('dayQuestion').textContent = t.day;
  $('levelsQuestion').textContent = t.levels;
  $('supportLabel').textContent = t.support;
  $('resistanceLabel').textContent = t.resistance;
  $('lockBtn').textContent = t.lock;
  $('lockFineprint').textContent = t.fine;
  $('navToday').textContent = t.today;
  $('navResult').textContent = t.result;
  $('navHistory').textContent = t.history;
  $('navScore').textContent = t.score;
  $('dialogTitle').textContent = t.dialogTitle;
  $('dialogText').textContent = t.dialogText;
  $('cancelLock').textContent = t.cancel;
  $('confirmLock').textContent = t.confirm;
  $('langToggle').textContent = state.language === 'en' ? 'தமிழ்' : 'EN';
  $('dateHeading').textContent = formatDate();
}

function showAuth(){
  $('authScreen').classList.remove('hidden');
  $('appShell').classList.add('hidden');
  renderExistingProfiles();
}

function showApp(){
  $('authScreen').classList.add('hidden');
  $('appShell').classList.remove('hidden');
  renderAll();
}

function renderExistingProfiles(){
  const wrap = $('existingProfiles');
  const profiles = Object.entries(root.profiles);
  if (!profiles.length) { wrap.innerHTML=''; return; }
  wrap.innerHTML = `<div class="saved-label">Profiles on this device</div>` + profiles.map(([id,p]) =>
    `<button class="saved-profile" data-profile-id="${encodeURIComponent(id)}" type="button">
      <span class="mini-avatar">${(p.name||'U').trim().charAt(0).toUpperCase()}</span>
      <span><b>${escapeHtml(p.name||'User')}</b><small>${escapeHtml(p.email||'')}</small></span>
    </button>`).join('');
}

function escapeHtml(v=''){
  return String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

$('authForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('authName').value.trim();
  const email = $('authEmail').value.trim().toLowerCase();
  if (!name || !email) return;
  const id = profileIdFromEmail(email);
  if (!root.profiles[id]) {
    root.profiles[id] = {id, name, email, createdAt:new Date().toISOString(), state:{predictions:[], language:'en'}};
    migrateLegacyIfNeeded(root.profiles[id]);
  } else {
    root.profiles[id].name = name;
  }
  ensureProfileState(root.profiles[id]);
  root.activeProfile = id;
  saveRoot();
  $('authForm').reset();
  showApp();
});

$('existingProfiles').addEventListener('click', e => {
  const btn = e.target.closest('[data-profile-id]'); if (!btn) return;
  root.activeProfile = decodeURIComponent(btn.dataset.profileId);
  saveRoot(); showApp();
});

$('profileButton').addEventListener('click', () => navigate('profile'));

$('profileForm').addEventListener('submit', e => {
  e.preventDefault();
  const profile = activeProfile(); if (!profile) return;
  const newName = $('editName').value.trim();
  const newEmail = $('editEmail').value.trim().toLowerCase();
  if (!newName || !newEmail) return;

  const oldId = root.activeProfile;
  const newId = profileIdFromEmail(newEmail);
  profile.name = newName; profile.email = newEmail;

  if (newId !== oldId) {
    if (root.profiles[newId]) { alert('A profile with that email already exists on this device.'); return; }
    delete root.profiles[oldId];
    profile.id = newId;
    root.profiles[newId] = profile;
    root.activeProfile = newId;
  }
  saveRoot(); renderAll();
});

$('signOutBtn').addEventListener('click', () => {
  root.activeProfile = null; saveRoot(); showAuth();
});

function syncChoiceButtons(){
  document.querySelectorAll('.choice-grid').forEach(group => {
    const key = group.dataset.group;
    group.querySelectorAll('.choice').forEach(btn => btn.classList.toggle('selected', btn.dataset.value === draft[key]));
  });
}

document.querySelectorAll('.choice-grid').forEach(group => {
  group.addEventListener('click', e => {
    const btn = e.target.closest('.choice'); if (!btn || current()) return;
    draft[group.dataset.group] = btn.dataset.value; syncChoiceButtons();
  });
});

$('predictionForm').addEventListener('submit', e => {
  e.preventDefault();
  if (current()) return;
  draft.support = $('support').value;
  draft.resistance = $('resistance').value;
  if (!draft.bias || !draft.opening || !draft.dayType || !draft.support || !draft.resistance) {
    alert('Please complete all fields before locking.'); return;
  }
  pendingPrediction = {...draft};
  $('lockDialog').showModal();
});

$('cancelLock').onclick = () => $('lockDialog').close();

$('confirmLock').onclick = async () => {
  if (!pendingPrediction) return;
  const state = activeState();
  const prediction = { date:dateKey, indexId:selectedIndexId, ...pendingPrediction, lockedAt:new Date().toISOString(), actual:null, score:null };
  state.predictions.push(prediction);
  try {
    if (window.PiZeroServices?.predictions && window.__MFT_SUPABASE_CLIENT) {
      const cloudPrediction = await window.PiZeroServices.predictions.createPrediction({
        index_id: selectedIndexId,
        trading_date: prediction.date,
        bias: prediction.bias,
        opening_view: prediction.opening,
        day_type: prediction.dayType,
        support: Number(prediction.support),
        resistance: Number(prediction.resistance)
      });
      prediction.cloudId = cloudPrediction?.id || null;
      prediction.cloudSync = 'synced';
    }
  } catch (_) {
    prediction.cloudSync = 'pending';
  }
  saveRoot(); $('lockDialog').close(); pendingPrediction=null; renderAll();
};

$('actualForm').addEventListener('submit', async e => {
  e.preventDefault();
  const p = selectedResultPrediction();
  if (!p) { alert('Lock today\'s prediction first.'); return; }
  const actual = {
    bias:$('actualBias').value,
    opening:$('actualOpening').value,
    dayType:$('actualDayType').value,
    low:Number($('actualLow').value),
    high:Number($('actualHigh').value)
  };
  if (!actual.low || !actual.high || actual.high < actual.low) {
    alert('Enter a valid actual low and high.'); return;
  }
  p.actual = actual;
  if (p.cloudId && window.PiZeroServices?.predictions?.scorePrediction) {
    try {
      const scored = await window.PiZeroServices.predictions.scorePrediction(p.cloudId);
      if (scored?.scoring_status === 'scored') {
        const detail = scored.score_details || {};
        p.score = { source:'server', total:Number(scored.score), detail:{ bias:detail.bias || 0, opening:detail.opening || 0, dayType:detail.day_type ?? detail.dayType ?? 0, support:detail.support || 0, resistance:detail.resistance || 0 }, rule_version:scored.scoring_rule_version };
      } else {
        p.score = null;
        alert('The server is waiting for the persisted market session before scoring this prediction.');
      }
    } catch (error) {
      alert(error.message || 'The server could not score this prediction yet.');
      return;
    }
  } else {
    // Keep local scoring only for the temporary pre-cloud migration fallback.
    p.score = calculateScore(p, actual);
    p.score.source = 'local';
  }
  p.actualSource = {mode:'manual', enteredAt:new Date().toISOString()};
  saveRoot(); renderAll();
});

function calculateScore(p,a){
  const detail = {};
  detail.bias = p.bias === a.bias ? 25 : 0;
  detail.opening = p.opening === a.opening ? 20 : 0;
  detail.dayType = p.dayType === a.dayType ? 20 : 0;
  const support = Number(p.support), resistance = Number(p.resistance);
  const supportTol = Math.max(25, support * 0.0025);
  const resistanceTol = Math.max(25, resistance * 0.0025);
  detail.support = Math.max(0, 17.5 * (1 - Math.abs(a.low-support)/supportTol));
  detail.resistance = Math.max(0, 17.5 * (1 - Math.abs(a.high-resistance)/resistanceTol));
  const total = Math.round(Object.values(detail).reduce((x,y)=>x+y,0));
  return {total, detail};
}

function renderToday(){
  const p=current();
  const disabled=!!p;
  document.querySelectorAll('#predictionForm button.choice').forEach(b=>b.disabled=disabled);
  $('support').disabled=disabled; $('resistance').disabled=disabled; $('lockBtn').disabled=disabled;
  if (p) {
    draft = {bias:p.bias, opening:p.opening, dayType:p.dayType, support:p.support, resistance:p.resistance};
    $('support').value=p.support; $('resistance').value=p.resistance; syncChoiceButtons();
    const time = new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:INDIA_TZ}).format(new Date(p.lockedAt));
    $('lockedBanner').classList.remove('hidden');
    $('lockedBanner').textContent = `🔒 ${i18n[activeState().language].lockedAt}: ${time} IST · ${p.bias} · ${p.opening} · ${p.dayType}`;
  } else {
    draft = { bias:null, opening:null, dayType:null, support:'', resistance:'' };
    $('support').value=''; $('resistance').value=''; syncChoiceButtons();
    $('lockedBanner').classList.add('hidden');
  }
}

function renderIndexSelector(){
  const select = $('indexSelect');
  if (!select) return;
  select.innerHTML = indices.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.display_name)}</option>`).join('');
  select.value = selectedIndexId;
}

function renderResult(){
  const p=current();
  const panel=$('scorePanel');
  if (p?.score) {
    panel.classList.remove('hidden');
    $('scoreValue').textContent=p.score.total;
    panel.querySelector('.score-ring').style.setProperty('--score',p.score.total);
    const d=p.score.detail;
    const metrics=[['Bias',d.bias,25],['Open',d.opening,20],['Day',d.dayType,20],['Support',d.support,17.5],['Resistance',d.resistance,17.5]];
    $('scoreBreakdown').innerHTML=metrics.map(([n,v,max])=>`<div class="metric"><b>${Math.round(v)}/${max}</b><small>${n}</small></div>`).join('');
    const source = p.score.source === 'server' || p.score.rule_version ? 'Server scored' : 'Local migration fallback · not included in server statistics';
    $('scoreSource').textContent = `${source}${p.score.rule_version ? ` · ${escapeHtml(p.score.rule_version)}` : ''}`;
    $('scoreSource').className = `score-source ${p.score.source === 'server' || p.score.rule_version ? 'server' : 'local'}`;
    $('scoreInsight').textContent = p.score.total>=80 ? 'Excellent market read today.' : p.score.total>=60 ? 'Good read, with room to improve.' : 'Today exposed useful gaps in your market read.';
    $('actualBias').value=p.actual.bias; $('actualOpening').value=p.actual.opening; $('actualDayType').value=p.actual.dayType;
    $('actualLow').value=p.actual.low; $('actualHigh').value=p.actual.high;
  } else {
    panel.classList.add('hidden');
    $('scoreSource').textContent = '';
  }
}

function filteredHistory(){
  const items=[...activeState().predictions].sort((a,b)=>b.date.localeCompare(a.date));
  if (historyFilter === 'scored') return items.filter(p=>p.score);
  if (historyFilter === '7') return items.slice(0,7);
  if (historyFilter === '30') return items.slice(0,30);
  return items;
}

function renderHistory(){
  const list=$('historyList');
  const items=filteredHistory();
  const scored=items.filter(p=>p.score);
  const avg=scored.length ? Math.round(scored.reduce((s,p)=>s+p.score.total,0)/scored.length) : null;
  $('historySummary').innerHTML = `<span>${items.length} session${items.length===1?'':'s'}</span><span>${avg===null?'No scored average':`Average ${avg}/100`}</span>`;
  if (!items.length){ list.innerHTML='<div class="empty">No history matches this filter.</div>'; return; }
  list.innerHTML=items.map(p=>{
    const d=new Date(p.date+'T12:00:00+05:30');
    const date=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric', timeZone:INDIA_TZ}).format(d);
    return `<div class="history-item">
      <div><div class="date">${date}</div><div class="meta">${escapeHtml(p.bias)} · ${escapeHtml(p.opening)} · ${escapeHtml(p.dayType)}</div></div>
      <div class="history-score">${p.score?p.score.total:'—'}</div>
    </div>`;
  }).join('');
}

document.querySelectorAll('[data-history-filter]').forEach(btn => btn.addEventListener('click', () => {
  historyFilter = btn.dataset.historyFilter;
  document.querySelectorAll('[data-history-filter]').forEach(x=>x.classList.toggle('active', x===btn));
  renderHistory();
}));

function renderScore(){
  const scored=activeState().predictions.filter(p=>p.score);
  if(!scored.length){
    $('avgScore').textContent='—';
    $('profileSessions').textContent='No scored sessions yet';
    $('skillBars').innerHTML='<div class="empty">Your skill profile appears after your first scored session.</div>';
    return;
  }
  const avg=Math.round(scored.reduce((s,p)=>s+p.score.total,0)/scored.length);
  $('avgScore').textContent=avg;
  $('profileSessions').textContent=`${scored.length} scored session${scored.length>1?'s':''}`;
  const metrics=[['Direction','bias',25],['Opening','opening',20],['Day type','dayType',20],['Support','support',17.5],['Resistance','resistance',17.5]];
  $('skillBars').innerHTML=metrics.map(([label,key,max])=>{
    const pct=Math.round(scored.reduce((s,p)=>s+(p.score.detail[key]/max)*100,0)/scored.length);
    return `<div class="skill"><div class="skill-head"><span>${label}</span><b>${pct}%</b></div><div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }).join('');
}

function renderServerDashboard(){
  const statsGrid = $('serverStatsGrid');
  const progress = $('serverProgress');
  const ranking = $('rankingList');
  const status = $('serverDashboardStatus');
  if (!statsGrid || !progress || !ranking || !status) return;

  if (serverDashboardState.status === 'loading') {
    status.textContent = 'Loading your protected server statistics…';
    statsGrid.innerHTML = '<div class="dashboard-loading">Reading your scored predictions from Supabase.</div>';
    progress.innerHTML = '<div class="dashboard-loading">Loading forward-test progress…</div>';
    ranking.innerHTML = '<div class="dashboard-loading">Loading opt-in ranking…</div>';
    return;
  }
  if (serverDashboardState.status === 'error') {
    status.textContent = serverDashboardState.message || 'Server statistics are temporarily unavailable.';
    statsGrid.innerHTML = '<div class="dashboard-empty">Refresh the page or sign in again to load protected statistics.</div>';
    progress.innerHTML = '<div class="dashboard-empty">Progress is unavailable right now.</div>';
    ranking.innerHTML = '<div class="dashboard-empty">Ranking is unavailable right now.</div>';
    return;
  }
  if (serverDashboardState.status !== 'ready') {
    status.textContent = 'Open this page to load your server-authoritative statistics.';
    statsGrid.innerHTML = '<div class="dashboard-empty">Your cloud statistics will appear here after loading.</div>';
    progress.innerHTML = '<div class="dashboard-empty">Your active and completed tests will appear here.</div>';
    ranking.innerHTML = '<div class="dashboard-empty">Only users who opt in and meet the ranking rule appear here.</div>';
    return;
  }

  const s = serverDashboardState.statistics || {};
  const localFallbackCount = (activeState()?.predictions || []).filter(p => p.score && !(p.score.source === 'server' || p.score.rule_version)).length;
  status.textContent = localFallbackCount
    ? `Loaded from Supabase. ${localFallbackCount} local fallback score${localFallbackCount === 1 ? '' : 's'} are not included in verified statistics.`
    : 'Loaded from Supabase · server-scored predictions only.';
  const value = (v, suffix = '') => v === null || v === undefined ? '—' : `${v}${suffix}`;
  statsGrid.innerHTML = [
    ['Total predictions', value(s.total_predictions)],
    ['Scored predictions', value(s.completed_predictions)],
    ['Correct predictions', value(s.correct_predictions)],
    ['Accuracy', value(s.accuracy_percentage, '%')],
    ['Average score', value(s.average_score, '/100')]
  ].map(([label, v]) => `<div class="server-stat"><b>${escapeHtml(v)}</b><small>${escapeHtml(label)}</small></div>`).join('');

  const active = serverDashboardState.progress?.active_test_period;
  const completed = serverDashboardState.progress?.completed_test_periods || [];
  if (active) {
    const done = active.completed_sessions ?? 0;
    const target = active.duration_sessions ?? '—';
    progress.innerHTML = `<div class="progress-summary"><div><span class="section-kicker">ACTIVE TEST</span><strong>${done} / ${target} sessions</strong><small>${escapeHtml(active.status || 'active')} · starts ${escapeHtml(active.start_date || '—')}</small></div><span class="panel-note">${escapeHtml(String(active.duration_sessions || '—'))} sessions</span></div><div class="server-progress-bar"><span style="width:${target && target !== '—' ? Math.min(100, Math.round(done / target * 100)) : 0}%"></span></div>`;
  } else {
    progress.innerHTML = `<div class="dashboard-empty">No active test period. Completed periods: ${completed.length}.</div>`;
  }

  if (!serverDashboardState.ranking.length) {
    ranking.innerHTML = '<div class="dashboard-empty">No public ranking entries are available. Ranking requires explicit opt-in and at least five scored predictions.</div>';
  } else {
    ranking.innerHTML = `<div class="ranking-head"><span>Username</span><span>Average · Accuracy</span></div>` + serverDashboardState.ranking.map(row => `<div class="ranking-row"><b>${escapeHtml(row.username || 'Anonymous')}</b><span>${escapeHtml(value(row.average_score, '/100'))} · ${escapeHtml(value(row.accuracy_percentage, '%'))}</span></div>`).join('');
  }
}

async function refreshServerDashboard(){
  if (!window.PiZeroServices?.statistics || !window.PiZeroServices?.ranking) return;
  serverDashboardState = {status:'loading', statistics:null, progress:null, ranking:[]};
  renderServerDashboard();
  try {
    const [statistics, progress, ranking] = await Promise.all([
      window.PiZeroServices.statistics.getMyStatistics(),
      window.PiZeroServices.statistics.getMyTestProgress(),
      window.PiZeroServices.ranking.getRanking()
    ]);
    serverDashboardState = {status:'ready', statistics, progress, ranking};
  } catch (error) {
    serverDashboardState = {status:'error', message:error.message, statistics:null, progress:null, ranking:[]};
  }
  renderServerDashboard();
}

function renderProfile(){
  const p=activeProfile(); if (!p) return;
  const preds=p.state.predictions, scored=preds.filter(x=>x.score);
  const initial=(p.name||'U').trim().charAt(0).toUpperCase();
  $('avatarInitial').textContent=initial;
  $('profileAvatar').textContent=initial;
  $('profileNameHeading').textContent=p.name;
  $('profileDisplayName').textContent=p.name;
  $('profileEmail').textContent=p.email;
  $('editName').value=p.name;
  $('editEmail').value=p.email;
  $('profilePredictions').textContent=preds.length;
  $('profileScored').textContent=scored.length;
  $('profileBest').textContent=scored.length ? Math.max(...scored.map(x=>x.score.total)) : '—';
}

function renderAll(){
  const p=activeProfile(); if(!p){ showAuth(); return; }
  ensureProfileState(p);
  setLanguage(); renderIndexSelector(); renderForwardTest(); renderToday(); renderResult(); renderHistory(); renderScore(); renderProfile();
  saveRoot();
}

async function loadIndexCatalog(){
  const fallback = [{id:'local-nifty50', code:'NIFTY50', display_name:'NIFTY 50'}];
  try {
    const remote = await window.PiZeroServices.indices.getIndices();
    indices = remote.length ? remote : fallback;
  } catch (_) {
    indices = fallback;
  }
  if (!indices.some(item => item.id === selectedIndexId)) {
    const nextId = indices[0].id;
    Object.values(root.profiles || {}).forEach(profile => {
      (profile.state?.predictions || []).forEach(prediction => {
        if (!prediction.indexId || prediction.indexId === 'local-nifty50') prediction.indexId = nextId;
      });
    });
    selectedIndexId = nextId;
  }
  renderAll();
}

document.getElementById('indexSelect')?.addEventListener('change', event => {
  selectedIndexId = event.target.value;
  renderAll();
});

$('langToggle').onclick=()=>{
  const state=activeState(); state.language=state.language==='en'?'ta':'en'; saveRoot(); renderAll();
};

$('themeToggle')?.addEventListener('click', toggleTheme);
$('authThemeToggle')?.addEventListener('click', toggleTheme);

function navigate(target){
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.target===target));
  document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===target));
  window.scrollTo({top:0,behavior:'smooth'});
}

document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
  const target = btn.dataset.target;
  if (target !== 'result') resultSelection = null;
  navigate(target);
  if (target === 'score') refreshServerDashboard();
}));
$('refreshServerDashboard')?.addEventListener('click', refreshServerDashboard);

applyTheme(currentTheme());

loadIndexCatalog();

if('serviceWorker' in navigator){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

if (root.activeProfile && root.profiles[root.activeProfile]) showApp(); else showAuth();
