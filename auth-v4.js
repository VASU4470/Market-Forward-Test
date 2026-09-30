(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const authScreen = document.getElementById('authScreen');
  const appShell = document.getElementById('appShell');
  const card = document.querySelector('.auth-card');
  const oldForm = document.getElementById('authForm');
  if (!authScreen || !appShell || !card || !oldForm) return;
  const localDevTest = ['localhost','127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('dev-test') === '1';
  if (localDevTest) {
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    authScreen.classList.add('auth-live-v3');
    const previewForm = oldForm.cloneNode(false);
    previewForm.id = 'authForm';
    previewForm.className = 'auth-v3-form';
    oldForm.replaceWith(previewForm);
    document.getElementById('existingProfiles')?.remove();
    const heading = card.querySelector('h2');
    const description = card.querySelector('p.muted');
    const status = document.createElement('div');
    status.className = 'auth-status-v3 ready';
    status.setAttribute('role','status');
    status.setAttribute('aria-live','polite');
    previewForm.after(status);
    let step = 'start';
    let person = {};
    const e = value => String(value || '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
    const select = (id,label,items) => `<label class="field-label"><span>${label}</span><select id="${id}">${items.map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>`;
    const checks = (name,label,items) => `<fieldset class="onboarding-choices"><legend>${label}</legend>${items.map(([v,t])=>`<label><input type="checkbox" name="${name}" value="${v}"><span>${t}</span></label>`).join('')}</fieldset>`;
    const selected = name => [...previewForm.querySelectorAll(`input[name="${name}"]:checked`)].map(x=>x.value);
    const say = (message,kind='ready') => { status.className=`auth-status-v3 ${kind}`; status.textContent=message; };
    function begin(){
      step='personal'; heading.textContent='Profile test · Personal details';
      description.textContent='Local preview only. Use a test password; nothing is sent or saved.';
      previewForm.innerHTML=`<div class="kyc-note"><strong>Simulated email verified</strong><p>test-user@pizero.local · This does not send email or create an account.</p></div><label class="field-label"><span>Display name *</span><input id="devName" maxlength="80" autocomplete="name"></label><label class="field-label"><span>Mobile number (optional)</span><input id="devMobile" type="tel" placeholder="+91 98765 43210"></label><p class="auth-helper-v3">Mobile verification is part of KYC — coming soon.</p>${select('devLanguage','Preferred language',[['en','English'],['ta','தமிழ்']])}<label class="field-label"><span>Test password</span><input id="devPassword" type="password" autocomplete="off" placeholder="Any 8 characters; not stored"></label><label class="field-label"><span>Confirm test password</span><input id="devConfirm" type="password" autocomplete="off"></label><button class="primary-btn" type="submit">CONTINUE <span>→</span></button>`;
      say('Developer test mode: local browser only. No Supabase calls are made.');
    }
    function trading(){
      step='trading'; heading.textContent='Profile test · Market profile';
      description.textContent='Step 2 of 2 · Explore optional trading and investing choices.';
      previewForm.innerHTML=`${select('devExperience','Market experience',[['','Choose'],['under_6m','Less than 6 months'],['6m_1y','6 months–1 year'],['1_3y','1–3 years'],['3_5y','3–5 years'],['5y_plus','5+ years']])}${select('devCapital','Approximate trading / investment capital',[['','Prefer not to say'],['under_50k','Below ₹50,000'],['50k_1l','₹50,000–₹1 lakh'],['1_5l','₹1–5 lakh'],['5_10l','₹5–10 lakh'],['10_25l','₹10–25 lakh'],['25l_plus','Above ₹25 lakh']])}${checks('devRoles','I am interested in',[['intraday','Intraday trading'],['swing','Swing / short-term trading'],['positional','Positional trading'],['options','Options trading'],['futures','Futures trading'],['investing','Investing']])}<div id="devOptions" class="conditional-profile hidden">${checks('devMarkets','Options markets',[['nifty','NIFTY'],['banknifty','BANK NIFTY'],['finnifty','FINNIFTY'],['midcpnifty','MIDCPNIFTY'],['sensex','SENSEX'],['bankex','BANKEX'],['stock_options','Stock options']])}${select('devOptionStyle','Options style',[['','Choose'],['buying','Option buying'],['selling','Option selling'],['both','Both']])}</div><div id="devInvesting" class="conditional-profile hidden">${select('devHorizon','Investment horizon',[['','Choose'],['under_1y','Under 1 year'],['1_3y','1–3 years'],['3_5y','3–5 years'],['5y_plus','5+ years']])}${checks('devAssets','Investment instruments',[['stocks','Stocks'],['etfs','ETFs'],['mutual_funds','Mutual funds'],['index_funds','Index funds'],['bonds','Bonds'],['gold','Gold'],['other','Other']])}</div>${select('devBroker','Current broker',[['','Prefer not to say'],['zerodha','Zerodha'],['dhan','Dhan'],['upstox','Upstox'],['angel_one','Angel One'],['groww','Groww'],['icici_direct','ICICI Direct'],['hdfc','HDFC Securities'],['kotak','Kotak'],['other','Other'],['none','No broker yet']])}<div class="kyc-note"><strong>KYC verification — Coming soon</strong><p>Mobile and PAN verification will be available later. PAN is not collected.</p></div><div class="auth-inline-actions"><button type="button" class="auth-text-btn" data-dev-back>← Back</button></div><button class="primary-btn" type="submit">PREVIEW COMPLETION <span>→</span></button>`;
      say('Select Options or Investing to reveal those extra profile questions.');
    }
    function complete(){
      const roles=selected('devRoles');
      const summary={...person,experience:previewForm.querySelector('#devExperience').value,capital_range:previewForm.querySelector('#devCapital').value,roles,option_markets:roles.includes('options')?selected('devMarkets'):[],option_style:roles.includes('options')?previewForm.querySelector('#devOptionStyle').value:'',investment_horizon:roles.includes('investing')?previewForm.querySelector('#devHorizon').value:'',investment_assets:roles.includes('investing')?selected('devAssets'):[],broker:previewForm.querySelector('#devBroker').value};
      step='done'; heading.textContent='Profile preview complete';
      description.textContent='This was a local preview; no account or profile was created.';
      previewForm.innerHTML=`<div class="account-summary"><h3>Details entered</h3><p>Name: ${e(summary.name)} · Email: test-user@pizero.local</p><p>Mobile: ${e(summary.mobile||'Not provided')} · Language: ${e(summary.language)}</p><p>Experience: ${e(summary.experience||'Not selected')} · Capital: ${e(summary.capital_range||'Not selected')}</p><p>Interests: ${e(summary.roles.join(', ')||'None selected')}</p><p>Options: ${e(summary.option_markets.join(', ')||'Not selected')} · Style: ${e(summary.option_style||'Not selected')}</p><p>Investments: ${e(summary.investment_assets.join(', ')||'Not selected')} · Horizon: ${e(summary.investment_horizon||'Not selected')}</p><p>Broker: ${e(summary.broker||'Not selected')}</p></div><button class="primary-btn" type="button" data-dev-restart>RESTART PROFILE TEST</button>`;
      say('Preview finished. Restart any time; nothing was saved.', 'success');
    }
    previewForm.addEventListener('click',event=>{
      if(event.target.closest('[data-dev-restart]')) begin();
      if(event.target.closest('[data-dev-back]')) { step='personal'; begin(); }
    });
    previewForm.addEventListener('change',event=>{
      if(event.target.name!=='devRoles') return;
      const roles=selected('devRoles');
      document.getElementById('devOptions')?.classList.toggle('hidden',!roles.includes('options'));
      document.getElementById('devInvesting')?.classList.toggle('hidden',!roles.includes('investing'));
    });
    previewForm.addEventListener('submit',event=>{
      event.preventDefault();
      if(step==='start'){begin();return;}
      if(step==='personal'){
        const name=previewForm.querySelector('#devName').value.trim();
        const mobile=previewForm.querySelector('#devMobile').value.trim().replace(/[\s()-]/g,'');
        const password=previewForm.querySelector('#devPassword').value;
        if(name.length<2){say('Enter a display name of at least 2 characters.','error');return;}
        if(mobile&&!/^\+[1-9]\d{7,14}$/.test(mobile)){say('Use a country code, for example +91 98765 43210.','error');return;}
        if(password.length<8){say('Use at least 8 characters for the test password.','error');return;}
        if(password!==previewForm.querySelector('#devConfirm').value){say('The test passwords do not match.','error');return;}
        person={name,mobile,language:previewForm.querySelector('#devLanguage').value};
        trading();return;
      }
      if(step==='trading') complete();
    });
    heading.textContent='Developer profile test';
    description.textContent='Run the profile creation screens locally without creating an email or Supabase user.';
    previewForm.innerHTML='<div class="kyc-note"><strong>Local only</strong><p>This mode is available only on localhost. It simulates verified email and does not send or save your data.</p></div><button class="primary-btn" type="submit">START PROFILE TEST <span>→</span></button>';
    say('Open this page on localhost with ?dev-test=1 to start.');
    return;
  }
  if (!cfg.supabaseUrl || !cfg.supabasePublishableKey || !window.supabase?.createClient) {
    if (!['localhost','127.0.0.1'].includes(location.hostname)) {
      authScreen.classList.remove('hidden'); appShell.classList.add('hidden');
      oldForm.replaceWith(Object.assign(document.createElement('p'), {
        className:'auth-status-v3 error',
        textContent:'Sign in is temporarily unavailable. The site administrator must configure Supabase authentication on the server.'
      }));
      document.getElementById('existingProfiles')?.remove();
    }
    return;
  }

  const form = oldForm.cloneNode(false);
  form.id = 'authForm';
  form.className = 'auth-v3-form';
  form.noValidate = true;
  oldForm.replaceWith(form);
  const oldSignOut = document.getElementById('signOutBtn');
  const signOutBtn = oldSignOut?.cloneNode(true);
  if (signOutBtn) oldSignOut.replaceWith(signOutBtn);

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  // Shared by the browser API service layer; never expose a service-role key here.
  window.__MFT_SUPABASE_CLIENT = client;
  document.body.classList.add('supabase-live');
  authScreen.classList.add('auth-live-v3');
  const title = card.querySelector('h2');
  const subtitle = card.querySelector('p.muted');
  const existingProfiles = document.getElementById('existingProfiles');
  if (existingProfiles) existingProfiles.innerHTML = '';
  const tabs = document.createElement('div');
  tabs.className = 'auth-flow-tabs';
  tabs.innerHTML = '<button class="auth-flow-tab active" type="button" data-flow="signin">SIGN IN</button><button class="auth-flow-tab" type="button" data-flow="signup">SIGN UP</button>';
  const status = document.createElement('div');
  status.className = 'auth-status-v3 ready';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  form.before(tabs);
  form.after(status);

  let flow = 'signin';
  let stage = 'entry';
  let busy = false;
  let accountUser = null;
  let basics = null;
  const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const emailField = '<label class="field-label"><span>Email</span><input id="authEmail" type="email" autocomplete="email" required placeholder="you@example.com" /></label>';
  const passwordField = (id, label, autocomplete) => `<label class="field-label"><span>${label}</span><div class="password-wrap"><input id="${id}" type="password" autocomplete="${autocomplete}" required /><button class="password-toggle" type="button" data-toggle-password="${id}">SHOW</button></div></label>`;
  const value = id => (document.getElementById(id)?.value || '').trim();
  const email = () => value('authEmail').toLowerCase();
  const validEmail = address => /^\S+@\S+\.\S+$/.test(address);
  const normalizeUsername = input => String(input || '').trim().replace(/^@+/, '').toLowerCase();
  const validUsername = input => /^[a-z0-9_]{3,24}$/.test(normalizeUsername(input));
  async function usernameAvailable(username, ownId = null) {
    const normalized = normalizeUsername(username);
    const {data, error} = await client.from('profiles').select('id').eq('username_normalized', normalized).maybeSingle();
    if (error) throw new Error('Profile storage is not configured yet. Apply supabase_profile_schema.sql in Supabase before creating accounts.');
    return !data || data.id === ownId;
  }
  async function saveCloudProfile(user, details) {
    if (window.PiZeroServices?.profile) {
      await window.PiZeroServices.profile.updateProfile({
        username: normalizeUsername(details.username),
        display_name: details.displayName,
        preferred_language: details.language || 'en',
        ranking_opt_in: Boolean(details.rankingOptIn),
        mobile_number: details.mobile || '',
        onboarding: details.onboarding || {},
        profile_completed: true
      });
      return;
    }
    const username = normalizeUsername(details.username);
    const {error} = await client.from('profiles').upsert({
      id: user.id, username, display_name: details.displayName, ranking_opt_in: Boolean(details.rankingOptIn),
      preferred_language: details.language || 'en'
    }, {onConflict:'id'});
    if (error) {
      if (error.code === '23505') throw new Error('That username is already taken. Choose another one.');
      throw error;
    }
  }
  function setStatus(message, kind = 'ready') { status.className = `auth-status-v3 ${kind}`; status.textContent = message; }
  function setBusy(next) { busy = next; card.classList.toggle('auth-busy', next); }
  function hideWorkspace() { authScreen.classList.remove('hidden'); appShell.classList.add('hidden'); }
  function clearAppProfile() {
    try { const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{}'); store.activeProfile = null; localStorage.setItem('marketForwardTestV2', JSON.stringify(store)); } catch (_) {}
  }
  function mirrorUser(user) {
    const key = user.email.toLowerCase();
    const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{}');
    store.profiles ||= {};
    const prior = store.profiles[key] || {};
    const meta = user.user_metadata || {};
    const language = meta.preferred_language || prior.state?.language || 'en';
    store.profiles[key] = {
      ...prior, id:key, name:meta.display_name || prior.name || key.split('@')[0], email:key,
      phone:meta.mobile_number || '', createdAt:prior.createdAt || user.created_at || new Date().toISOString(),
      state:prior.state || {predictions:[],language}, supabaseUserId:user.id,
      authProvider:'supabase', authVerified:true, onboarding:meta.onboarding || prior.onboarding || {}
    };
    store.profiles[key].state.language = language;
    store.activeProfile = key;
    localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
  }
  function renderAccountProfile(user) {
    const meta = user.user_metadata || {};
    const details = meta.onboarding || {};
    const profileForm = document.getElementById('profileForm');
    if (!profileForm) return;
    const note = document.querySelector('#profile > .fineprint');
    if (note) note.textContent = 'Your account details are saved with Supabase. Prediction history is stored in this browser for now.';
    // Replace the local prototype's edit form: its email edit only changes browser storage.
    const safeForm = profileForm.cloneNode(false);
    profileForm.replaceWith(safeForm);
    safeForm.innerHTML = `<div class="panel-head"><div><span class="section-kicker">ACCOUNT</span><h2>Personal information</h2></div></div>
      <label class="field-label"><span>Username</span><input id="accountUsername" maxlength="24" required value="${escapeHtml(meta.username || '')}" /><small class="auth-helper-v3">Your unique public identity. Letters, numbers, and underscores only.</small></label>
      <label class="field-label"><span>Display name</span><input id="accountName" maxlength="80" required value="${escapeHtml(meta.display_name || '')}" /></label>
      <label class="field-label"><span>Verified email</span><input type="email" readonly value="${escapeHtml(user.email)}" /></label>
      <label class="field-label"><span>Mobile (unverified)</span><input id="accountMobile" type="tel" maxlength="24" value="${escapeHtml(meta.mobile_number || '')}" placeholder="Optional, include country code" /></label>
      <label class="field-label"><span>Preferred language</span><select id="accountLanguage"><option value="en">English</option><option value="ta">தமிழ்</option></select></label>
      <label class="field-label"><span class="checkbox-line"><input id="accountRankingOptIn" type="checkbox" ${meta.ranking_opt_in ? 'checked' : ''} /> Participate in the public ranking</span><small class="auth-helper-v3">Only your username and ranking information are public.</small></label>
      <button class="primary-btn" type="submit">SAVE PERSONAL DETAILS</button>
      <div class="account-security"><h3>Security</h3><button type="button" class="auth-text-btn" data-account-action="password">Change password</button><button type="button" class="auth-text-btn" data-account-action="email">Change email</button><button type="button" class="auth-text-btn" data-account-action="signout-all">Sign out all devices</button></div>
      <div class="kyc-note"><strong>KYC verification — Coming soon</strong><p>Mobile and PAN verification are not available yet. PAN is not collected.</p></div>
      <div class="account-summary"><h3>Market profile</h3><p>Interests: ${escapeHtml((details.roles || []).join(', ') || 'Not specified')}</p><p>Experience: ${escapeHtml(details.experience || 'Not specified')} · Capital range: ${escapeHtml(details.capital_range || 'Not specified')}</p><p>Broker: ${escapeHtml(details.broker || 'Not specified')}</p></div><div class="account-danger"><h3>Danger zone</h3><p>Permanently delete your account, profile, and local forward-test record.</p><button type="button" class="danger-btn" data-account-action="delete">DELETE ACCOUNT PERMANENTLY</button></div>`;
    safeForm.querySelector('#accountLanguage').value = meta.preferred_language || 'en';
    safeForm.addEventListener('submit', async event => {
      event.preventDefault();
      const username = normalizeUsername(safeForm.querySelector('#accountUsername').value), name = safeForm.querySelector('#accountName').value.trim();
      const mobile = safeForm.querySelector('#accountMobile').value.trim();
      if (!validUsername(username)) { alert('Choose a username with 3–24 lowercase letters, numbers, or underscores.'); return; }
      if (!(await usernameAvailable(username, user.id))) { alert('That username is already taken. Choose another one.'); return; }
      if (name.length < 2) { alert('Enter a display name of at least 2 characters.'); return; }
      if (mobile && !/^\+[1-9]\d{7,14}$/.test(mobile.replace(/[\s()-]/g,''))) { alert('Include the mobile country code.'); return; }
      const rankingOptIn = Boolean(safeForm.querySelector('#accountRankingOptIn').checked);
      const {data,error} = await client.auth.updateUser({data:{username,display_name:name,mobile_number:mobile,preferred_language:safeForm.querySelector('#accountLanguage').value,ranking_opt_in:rankingOptIn}});
      if (error) { alert(error.message); return; }
      await saveCloudProfile(data.user, {username,displayName:name,mobile,language:safeForm.querySelector('#accountLanguage').value,rankingOptIn});
      mirrorUser(data.user);
      location.reload();
    });
    safeForm.addEventListener('click', async event => {
      const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
      if (!action) return;
      if (action === 'password') {
        const next = prompt('Enter a new password (at least 8 characters):');
        if (!next || next.length < 8) return alert('Use at least 8 characters.');
        const {error} = await client.auth.updateUser({password:next});
        alert(error ? error.message : 'Password changed successfully.');
      } else if (action === 'email') {
        const next = prompt('Enter your new email address:');
        if (!validEmail(String(next || '').trim())) return alert('Enter a valid email address.');
        const {error} = await client.auth.updateUser({email:String(next).trim().toLowerCase()});
        alert(error ? error.message : 'Confirmation links were sent to your email addresses.');
      } else if (action === 'signout-all') {
        const {error} = await client.auth.signOut({scope:'others'});
        alert(error ? error.message : 'Other sessions have been signed out.');
      } else if (action === 'delete') {
        if (prompt('Type DELETE to permanently remove your account:') !== 'DELETE') return;
        const {data:{session}} = await client.auth.getSession();
        const response = await fetch('/api/account/delete', {method:'POST',headers:{Authorization:`Bearer ${session?.access_token || ''}`}});
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return alert(result.error || 'Account deletion is not configured yet.');
        await client.auth.signOut(); clearAppProfile(); flow='signin'; hideWorkspace(); showEntry('Your account was permanently deleted.','success');
      }
    });
  }
  function showEntry(message = '', kind = 'ready') {
    stage = 'entry'; accountUser = null; basics = null;
    tabs.classList.remove('hidden');
    tabs.querySelectorAll('[data-flow]').forEach(button => button.classList.toggle('active', button.dataset.flow === flow));
    title.textContent = flow === 'signin' ? 'Welcome back.' : 'Create your account.';
    subtitle.textContent = flow === 'signin' ? 'Sign in with your email and password.' : 'Verify your email with a link, then complete your profile and password.';
    form.innerHTML = flow === 'signin'
      ? `${emailField}${passwordField('authPassword','Password','current-password')}<button class="primary-btn" type="submit">SIGN IN <span>→</span></button><button class="auth-text-btn" type="button" data-action="forgot">Forgot password?</button>`
      : `${emailField}<button class="primary-btn" type="submit">SEND VERIFICATION LINK <span>→</span></button><div class="auth-helper-v3">Check your inbox for the link. If you already have an account, use Sign In or Forgot password.</div>`;
    setStatus(message || (flow === 'signup' ? 'The verification link returns you here to finish registration.' : ''), kind);
  }
  function showSent(address, reset = false) {
    stage = 'sent'; tabs.classList.add('hidden');
    title.textContent = 'Check your email.';
    subtitle.textContent = reset ? 'Open the password reset link we sent.' : 'Open the verification link we sent to continue creating your account.';
    form.innerHTML = `<p class="auth-helper-v3">Sent to ${escapeHtml(address)}. Check your spam folder too.</p><div class="auth-inline-actions"><button type="button" class="auth-text-btn" data-action="back">← Back to sign in</button><button type="button" class="auth-text-btn" data-action="resend">Resend link</button></div>`;
    form.dataset.sentEmail = address;
    form.dataset.sentReset = String(reset);
    setStatus('For your privacy, we show the same confirmation whether or not that email is registered.', 'success');
  }
  function showResetRequest() {
    stage = 'forgot'; tabs.classList.add('hidden');
    title.textContent = 'Reset your password.';
    subtitle.textContent = 'Enter your account email for a reset link.';
    form.innerHTML = `${emailField}<button class="primary-btn" type="submit">SEND RESET LINK <span>→</span></button><button type="button" class="auth-text-btn" data-action="back">← Back to sign in</button>`;
    setStatus('If the address has an account, a reset email will arrive.', 'ready');
  }
  function showNewPassword() {
    stage = 'reset'; tabs.classList.add('hidden'); hideWorkspace();
    title.textContent = 'Choose a new password.';
    subtitle.textContent = 'Your reset link has been verified.';
    form.innerHTML = `${passwordField('authNewPassword','New password','new-password')}${passwordField('authConfirmPassword','Confirm password','new-password')}<button class="primary-btn" type="submit">SAVE PASSWORD <span>→</span></button>`;
    setStatus('Use at least 8 characters.', 'ready');
  }
  function showBasics(user) {
    stage = 'basics'; accountUser = user; tabs.classList.add('hidden'); hideWorkspace(); clearAppProfile();
    title.textContent = 'Complete your profile.';
    subtitle.textContent = 'Step 1 of 2 · Personal details and account security.';
    form.innerHTML = `<div class="complete-stage-v3"><span class="section-kicker">EMAIL VERIFIED</span><h3>${escapeHtml(user.email)}</h3><label class="field-label"><span>Unique username *</span><input id="authUsername" autocomplete="username" maxlength="24" required placeholder="vasanthtrades" value="${escapeHtml(basics?.username || user.user_metadata?.username || '')}" /><small class="auth-helper-v3">3–24 characters: letters, numbers, and underscores.</small></label><label class="field-label"><span>Display name *</span><input id="authName" autocomplete="name" maxlength="80" required value="${escapeHtml(basics?.name || user.user_metadata?.display_name || '')}" /></label><label class="field-label"><span>Mobile number (optional)</span><input id="authMobile" type="tel" autocomplete="tel" maxlength="24" placeholder="+91 98765 43210" value="${escapeHtml(basics?.mobile || '')}" /></label><p class="auth-helper-v3">Mobile verification is part of KYC — coming soon. This number cannot be used to sign in yet.</p><label class="field-label"><span>Preferred language</span><select id="authLanguage"><option value="en">English</option><option value="ta">தமிழ்</option></select></label><label class="field-label"><span class="checkbox-line"><input id="authRankingOptIn" type="checkbox" /> Participate in the public ranking</span><small class="auth-helper-v3">Only your username and performance rank will be public.</small></label>${passwordField('authNewPassword','Create password','new-password')}${passwordField('authConfirmPassword','Confirm password','new-password')}<div class="password-rules">Use at least 8 characters.</div><button class="primary-btn" type="submit">CONTINUE <span>→</span></button></div>`;
    document.getElementById('authLanguage').value = basics?.language || user.user_metadata?.preferred_language || 'en';
    setStatus('Your email is verified. Finish both steps before signing in.', 'success');
  }
  const select = (id, label, options) => `<label class="field-label"><span>${label}</span><select id="${id}">${options.map(([key,text])=>`<option value="${key}">${text}</option>`).join('')}</select></label>`;
  const choices = (id, label, options) => `<fieldset class="onboarding-choices"><legend>${label}</legend>${options.map(([key,text])=>`<label><input type="checkbox" name="${id}" value="${key}" /><span>${text}</span></label>`).join('')}</fieldset>`;
  function showTrading() {
    stage = 'trading'; title.textContent = 'Your market profile.';
    subtitle.textContent = 'Step 2 of 2 · Choose what applies to you. You can change this later.';
    form.innerHTML = `<div class="complete-stage-v3">${select('authExperience','Market experience', [['','Choose an option'],['under_6m','Less than 6 months'],['6m_1y','6 months–1 year'],['1_3y','1–3 years'],['3_5y','3–5 years'],['5y_plus','5+ years']])}${select('authCapital','Approximate trading / investment capital', [['','Prefer not to say'],['under_50k','Below ₹50,000'],['50k_1l','₹50,000–₹1 lakh'],['1_5l','₹1–5 lakh'],['5_10l','₹5–10 lakh'],['10_25l','₹10–25 lakh'],['25l_plus','Above ₹25 lakh']])}${choices('marketRoles','I am interested in', [['intraday','Intraday trading'],['swing','Swing / short-term trading'],['positional','Positional trading'],['options','Options trading'],['futures','Futures trading'],['investing','Investing']])}<div id="optionsDetail" class="conditional-profile hidden">${choices('optionMarkets','Options markets', [['nifty','NIFTY'],['banknifty','BANK NIFTY'],['finnifty','FINNIFTY'],['midcpnifty','MIDCPNIFTY'],['sensex','SENSEX'],['bankex','BANKEX'],['stock_options','Stock options']])}${select('authOptionStyle','Options style',[['','Choose an option'],['buying','Buying'],['selling','Selling'],['both','Both']])}</div><div id="investingDetail" class="conditional-profile hidden">${select('authHorizon','Investment horizon',[['','Choose an option'],['under_1y','Under 1 year'],['1_3y','1–3 years'],['3_5y','3–5 years'],['5y_plus','5+ years']])}${choices('investmentAssets','Investment instruments',[['stocks','Stocks'],['etfs','ETFs'],['mutual_funds','Mutual funds'],['index_funds','Index funds'],['bonds','Bonds'],['gold','Gold'],['other','Other']])}</div>${select('authBroker','Current broker',[['','Prefer not to say'],['zerodha','Zerodha'],['dhan','Dhan'],['upstox','Upstox'],['angel_one','Angel One'],['groww','Groww'],['icici_direct','ICICI Direct'],['hdfc_securities','HDFC Securities'],['kotak','Kotak'],['other','Other'],['none','No broker yet']])}<div class="kyc-note"><strong>KYC verification — Coming soon</strong><p>Mobile and PAN verification will be available later. Do not enter your PAN here.</p></div><div class="auth-inline-actions"><button type="button" class="auth-text-btn" data-action="basics">← Back</button></div><button class="primary-btn" type="submit">CREATE ACCOUNT <span>→</span></button></div>`;
    setStatus('Your answers help personalize PiZero; all trading questions are optional.', 'ready');
  }
  function selected(name) { return [...form.querySelectorAll(`input[name="${name}"]:checked`)].map(input => input.value); }
  function updateConditional() {
    const roles = selected('marketRoles');
    document.getElementById('optionsDetail')?.classList.toggle('hidden', !roles.includes('options'));
    document.getElementById('investingDetail')?.classList.toggle('hidden', !roles.includes('investing'));
  }
  function validatePasswords() {
    const password = document.getElementById('authNewPassword')?.value || '';
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    if (password !== document.getElementById('authConfirmPassword')?.value) throw new Error('The two passwords do not match.');
    return password;
  }
  async function requestLink(address, reset = false) {
    if (!validEmail(address)) throw new Error('Enter a valid email address.');
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const {error} = reset
      ? await client.auth.resetPasswordForEmail(address, {redirectTo})
      : await client.auth.signInWithOtp({email:address,options:{shouldCreateUser:true,emailRedirectTo:redirectTo}});
    if (error) throw error;
    showSent(address, reset);
  }
  async function finishAccount() {
    const roles = selected('marketRoles');
    const onboarding = {
      experience:value('authExperience'),capital_range:value('authCapital'),roles,
      options_markets:roles.includes('options')?selected('optionMarkets'):[],
      options_style:roles.includes('options')?value('authOptionStyle'):'',
      investment_horizon:roles.includes('investing')?value('authHorizon'):'',
      investment_assets:roles.includes('investing')?selected('investmentAssets'):[],
      broker:value('authBroker')
    };
    // Save all details with the account, so they are available on another device.
    const {data,error} = await client.auth.updateUser({password:basics.password,data:{username:basics.username,display_name:basics.name,preferred_language:basics.language,mobile_number:basics.mobile,onboarding,ranking_opt_in:basics.rankingOptIn,mft_account_complete:true}});
    if (error) throw error;
    if (!data.user) throw new Error('Account setup did not finish. Please try again.');
    await saveCloudProfile(data.user, {username:basics.username, displayName:basics.name, mobile:basics.mobile, language:basics.language, rankingOptIn:basics.rankingOptIn, onboarding});
    await client.auth.signOut();
    clearAppProfile(); flow = 'signin'; showEntry('Account created. Sign in with your email and password.', 'success');
  }
  async function processLink() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const query = new URLSearchParams(location.search);
    const linkError = hash.get('error_description') || query.get('error_description');
    if (linkError) { history.replaceState(null,'',location.pathname); hideWorkspace(); showEntry(); setStatus(linkError.replace(/\+/g,' '),'error'); return true; }
    const token = hash.get('access_token'), refresh = hash.get('refresh_token');
    const code = query.get('code');
    if (!((token && refresh) || code)) return false;
    const type = hash.get('type') || query.get('type');
    // Clear tokens from browser history before asynchronous auth calls.
    history.replaceState(null,'',location.pathname);
    const {data,error} = code ? await client.auth.exchangeCodeForSession(code) : await client.auth.setSession({access_token:token,refresh_token:refresh});
    if (error) { hideWorkspace(); showEntry(); setStatus(error.message,'error'); return true; }
    const user = data.user || data.session?.user;
    if (type === 'recovery') { showNewPassword(); return true; }
    if (!user) throw new Error('Verification link did not return an account.');
    if (user.user_metadata?.mft_account_complete === true) {
      await client.auth.signOut(); hideWorkspace(); clearAppProfile(); flow='signin'; showEntry('An account already exists with this email. Sign in or use Forgot password.', 'error'); return true;
    }
    showBasics(user); return true;
  }
  async function enforceSession() {
    if (await processLink()) return;
    const {data,error} = await client.auth.getSession();
    if (error) throw error;
    const user = data.session?.user;
    if (!user) { clearAppProfile(); hideWorkspace(); showEntry(); return; }
    if (user.user_metadata?.mft_account_complete === true) {
      mirrorUser(user);
      renderAccountProfile(user);
      try {
        const remoteIndices = await window.PiZeroServices?.indices?.getIndices();
        const defaultIndex = remoteIndices?.[0]?.id;
        await window.PiZeroServices?.predictions?.migrateLocalPredictions(user.id, defaultIndex);
      } catch (_) {
        // Keep the local cache available if the Phase 1 schema/API is not deployed yet.
      }
      authScreen.classList.add('hidden'); appShell.classList.remove('hidden'); return;
    }
    showBasics(user);
  }
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-flow]');
    if (!button || busy) return;
    flow = button.dataset.flow; showEntry();
  });
  form.addEventListener('change', event => { if (event.target.name === 'marketRoles') updateConditional(); });
  form.addEventListener('click', async event => {
    const toggle = event.target.closest('[data-toggle-password]');
    if (toggle) { const input = document.getElementById(toggle.dataset.togglePassword); input.type = input.type === 'password'?'text':'password'; toggle.textContent=input.type==='password'?'SHOW':'HIDE'; return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || busy) return;
    if (action === 'forgot') showResetRequest();
    if (action === 'back') { flow='signin'; showEntry(); }
    if (action === 'basics') showBasics(accountUser);
    if (action === 'resend') {
      setBusy(true);
      try { await requestLink(form.dataset.sentEmail,form.dataset.sentReset === 'true'); }
      catch (error) { setStatus(error.message,'error'); }
      finally { setBusy(false); }
    }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      if (stage === 'entry' && flow === 'signin') {
        const address = email(), password = document.getElementById('authPassword')?.value || '';
        if (!validEmail(address) || !password) throw new Error('Enter a valid email and password.');
        const {data,error} = await client.auth.signInWithPassword({email:address,password});
        if (error) throw error;
        const user = data.user || data.session?.user;
        if (!user || user.user_metadata?.mft_account_complete !== true) {
          await client.auth.signOut(); throw new Error('Account setup is incomplete. Choose Sign Up to finish registration.');
        }
        mirrorUser(user); location.reload(); return;
      }
      if (stage === 'entry' || stage === 'forgot') { await requestLink(email(),stage==='forgot'); return; }
      if (stage === 'reset') {
        const password = validatePasswords();
        const {error} = await client.auth.updateUser({password}); if (error) throw error;
        await client.auth.signOut(); clearAppProfile(); flow='signin'; showEntry('Password updated. Sign in with your new password.','success'); return;
      }
      if (stage === 'basics') {
        const username = normalizeUsername(value('authUsername')), name = value('authName'), mobile = value('authMobile');
        if (!validUsername(username)) throw new Error('Choose a username with 3–24 lowercase letters, numbers, or underscores.');
        if (!(await usernameAvailable(username))) throw new Error('That username is already taken. Choose another one.');
        if (name.length < 2) throw new Error('Enter a display name of at least 2 characters.');
        if (mobile && !/^\+[1-9]\d{7,14}$/.test(mobile.replace(/[\s()-]/g,''))) throw new Error('Enter the mobile number with country code, such as +91 98765 43210.');
        basics = {username,name,mobile,language:value('authLanguage'),rankingOptIn:Boolean(document.getElementById('authRankingOptIn')?.checked),password:validatePasswords()};
        showTrading(); return;
      }
      if (stage === 'trading') await finishAccount();
    } catch (error) { setStatus(error.message || 'Could not complete this request.','error'); }
    finally { setBusy(false); }
  });
  signOutBtn?.addEventListener('click', async () => {
    await client.auth.signOut(); clearAppProfile(); flow='signin'; hideWorkspace(); showEntry('You have signed out.','success');
  });
  enforceSession().catch(error => {
    clearAppProfile(); hideWorkspace(); showEntry(); setStatus(error.message || 'Authentication service is unavailable.','error');
  });
})();
