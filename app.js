const STORAGE_KEY = 'marketForwardTestV1';
const TODAY = new Date();
const dateKey = TODAY.toISOString().slice(0,10);

const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"predictions":[],"language":"en"}');
if (!state.predictions) state.predictions = [];
if (!state.language) state.language = 'en';

let draft = { bias:null, opening:null, dayType:null, support:'', resistance:'' };
let pendingPrediction = null;

const $ = id => document.getElementById(id);
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
const current = () => state.predictions.find(p => p.date === dateKey);

const i18n = {
  en: {
    todayLabel:'TODAY · NIFTY', intro:'Record your pre-market view and lock it before the session.',
    bias:'What is your Nifty bias?', opening:'Expected opening?', day:'Expected day type?', levels:'Key levels', support:'Support', resistance:'Resistance',
    lock:'🔒 LOCK MY VIEW', fine:'Once locked, today\'s prediction cannot be edited.', result:'Result', history:'History', score:'My Score', today:'Today',
    lockedAt:'Prediction locked at', dialogTitle:'Lock today\'s view?', dialogText:'After locking, you cannot change this prediction.', cancel:'Cancel', confirm:'LOCK IT'
  },
  ta: {
    todayLabel:'இன்று · NIFTY', intro:'மார்க்கெட் தொடங்குவதற்கு முன் உங்கள் பார்வையை பதிவு செய்து lock செய்யுங்கள்.',
    bias:'இன்றைய Nifty bias என்ன?', opening:'Opening எப்படி இருக்கும்?', day:'Day type என்ன?', levels:'முக்கிய levels', support:'Support', resistance:'Resistance',
    lock:'🔒 என் VIEW-ஐ LOCK செய்', fine:'Lock செய்த பிறகு இன்றைய prediction-ஐ மாற்ற முடியாது.', result:'முடிவு', history:'வரலாறு', score:'என் Score', today:'இன்று',
    lockedAt:'Prediction lock செய்த நேரம்', dialogTitle:'இன்றைய view-ஐ lock செய்யவா?', dialogText:'Lock செய்த பிறகு இந்த prediction-ஐ மாற்ற முடியாது.', cancel:'Cancel', confirm:'LOCK செய்'
  }
};

function formatDate(d=TODAY){
  return new Intl.DateTimeFormat(state.language === 'ta' ? 'ta-IN' : 'en-IN', {weekday:'long', day:'numeric', month:'long', year:'numeric'}).format(d);
}

function setLanguage(){
  const t = i18n[state.language];
  $('todayLabel').textContent = t.todayLabel;
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
$('confirmLock').onclick = () => {
  if (!pendingPrediction) return;
  state.predictions.push({date:dateKey, ...pendingPrediction, lockedAt:new Date().toISOString(), actual:null, score:null});
  save(); $('lockDialog').close(); pendingPrediction=null; renderAll();
};

$('actualForm').addEventListener('submit', e => {
  e.preventDefault();
  const p = current();
  if (!p) { alert('Lock today\'s prediction first.'); return; }
  const actual = {bias:$('actualBias').value, opening:$('actualOpening').value, dayType:$('actualDayType').value, low:Number($('actualLow').value), high:Number($('actualHigh').value)};
  if (!actual.low || !actual.high || actual.high < actual.low) { alert('Enter a valid actual low and high.'); return; }
  p.actual = actual;
  p.score = calculateScore(p, actual);
  save(); renderAll();
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
    const time = new Intl.DateTimeFormat('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true,timeZone:'Asia/Kolkata'}).format(new Date(p.lockedAt));
    $('lockedBanner').classList.remove('hidden');
    $('lockedBanner').textContent = `🔒 ${i18n[state.language].lockedAt}: ${time} IST · ${p.bias} · ${p.opening} · ${p.dayType}`;
  } else {
    $('lockedBanner').classList.add('hidden');
  }
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
    $('scoreInsight').textContent = p.score.total>=80 ? 'Excellent market read today.' : p.score.total>=60 ? 'Good read, with room to improve.' : 'Today exposed useful gaps in your market read.';
    $('actualBias').value=p.actual.bias; $('actualOpening').value=p.actual.opening; $('actualDayType').value=p.actual.dayType; $('actualLow').value=p.actual.low; $('actualHigh').value=p.actual.high;
  } else panel.classList.add('hidden');
}

function renderHistory(){
  const list=$('historyList');
  const items=[...state.predictions].sort((a,b)=>b.date.localeCompare(a.date));
  if (!items.length){list.innerHTML='<div class="empty">No predictions yet. Lock your first market view from the Today tab.</div>';return;}
  list.innerHTML=items.map(p=>{
    const d=new Date(p.date+'T12:00:00');
    const date=new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric'}).format(d);
    return `<div class="history-item"><div><div class="date">${date}</div><div class="meta">${p.bias} · ${p.opening} · ${p.dayType}</div></div><div class="history-score">${p.score?p.score.total:'—'}</div></div>`;
  }).join('');
}

function renderProfile(){
  const scored=state.predictions.filter(p=>p.score);
  if(!scored.length){$('avgScore').textContent='—';$('profileSessions').textContent='No scored sessions yet';$('skillBars').innerHTML='<div class="empty">Your skill profile appears after your first scored session.</div>';return;}
  const avg=Math.round(scored.reduce((s,p)=>s+p.score.total,0)/scored.length);
  $('avgScore').textContent=avg; $('profileSessions').textContent=`${scored.length} scored session${scored.length>1?'s':''}`;
  const metrics=[['Direction','bias',25],['Opening','opening',20],['Day type','dayType',20],['Support','support',17.5],['Resistance','resistance',17.5]];
  $('skillBars').innerHTML=metrics.map(([label,key,max])=>{
    const pct=Math.round(scored.reduce((s,p)=>s+(p.score.detail[key]/max)*100,0)/scored.length);
    return `<div class="skill"><div class="skill-head"><span>${label}</span><b>${pct}%</b></div><div class="bar"><span style="width:${pct}%"></span></div></div>`;
  }).join('');
}

function renderAll(){setLanguage();renderToday();renderResult();renderHistory();renderProfile();}

$('langToggle').onclick=()=>{state.language=state.language==='en'?'ta':'en';save();renderAll();};
document.querySelectorAll('.nav-item').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('active'));btn.classList.add('active');
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));$(btn.dataset.target).classList.add('active');window.scrollTo({top:0,behavior:'smooth'});
}));

if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));}
renderAll();
