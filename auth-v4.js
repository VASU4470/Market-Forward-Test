(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const authScreen = document.getElementById('authScreen');
  const appShell = document.getElementById('appShell');
  const card = document.querySelector('.auth-card');
  const oldForm = document.getElementById('authForm');
  if (!authScreen || !appShell || !card || !oldForm) return;
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
      <label class="field-label"><span>Display name</span><input id="accountName" maxlength="80" required value="${escapeHtml(meta.display_name || '')}" /></label>
      <label class="field-label"><span>Verified email</span><input type="email" readonly value="${escapeHtml(user.email)}" /></label>
      <label class="field-label"><span>Mobile (unverified)</span><input id="accountMobile" type="tel" maxlength="24" value="${escapeHtml(meta.mobile_number || '')}" placeholder="Optional, include country code" /></label>
      <label class="field-label"><span>Preferred language</span><select id="accountLanguage"><option value="en">English</option><option value="ta">தமிழ்</option></select></label>
      <button class="primary-btn" type="submit">SAVE PERSONAL DETAILS</button>
      <div class="kyc-note"><strong>KYC verification — Coming soon</strong><p>Mobile and PAN verification are not available yet. PAN is not collected.</p></div>
      <div class="account-summary"><h3>Market profile</h3><p>Interests: ${escapeHtml((details.roles || []).join(', ') || 'Not specified')}</p><p>Experience: ${escapeHtml(details.experience || 'Not specified')} · Capital range: ${escapeHtml(details.capital_range || 'Not specified')}</p><p>Broker: ${escapeHtml(details.broker || 'Not specified')}</p></div>`;
    safeForm.querySelector('#accountLanguage').value = meta.preferred_language || 'en';
    safeForm.addEventListener('submit', async event => {
      event.preventDefault();
      const name = safeForm.querySelector('#accountName').value.trim();
      const mobile = safeForm.querySelector('#accountMobile').value.trim();
      if (name.length < 2) { alert('Enter a display name of at least 2 characters.'); return; }
      if (mobile && !/^\+[1-9]\d{7,14}$/.test(mobile.replace(/[\s()-]/g,''))) { alert('Include the mobile country code.'); return; }
      const {data,error} = await client.auth.updateUser({data:{display_name:name,mobile_number:mobile,preferred_language:safeForm.querySelector('#accountLanguage').value}});
      if (error) { alert(error.message); return; }
      mirrorUser(data.user);
      location.reload();
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
    form.innerHTML = `<div class="complete-stage-v3"><span class="section-kicker">EMAIL VERIFIED</span><h3>${escapeHtml(user.email)}</h3><label class="field-label"><span>Display name *</span><input id="authName" autocomplete="name" maxlength="80" required value="${escapeHtml(basics?.name || user.user_metadata?.display_name || '')}" /></label><label class="field-label"><span>Mobile number (optional)</span><input id="authMobile" type="tel" autocomplete="tel" maxlength="24" placeholder="+91 98765 43210" value="${escapeHtml(basics?.mobile || '')}" /></label><p class="auth-helper-v3">Mobile verification is part of KYC — coming soon. This number cannot be used to sign in yet.</p><label class="field-label"><span>Preferred language</span><select id="authLanguage"><option value="en">English</option><option value="ta">தமிழ்</option></select></label>${passwordField('authNewPassword','Create password','new-password')}${passwordField('authConfirmPassword','Confirm password','new-password')}<div class="password-rules">Use at least 8 characters.</div><button class="primary-btn" type="submit">CONTINUE <span>→</span></button></div>`;
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
    const {data,error} = await client.auth.updateUser({password:basics.password,data:{display_name:basics.name,preferred_language:basics.language,mobile_number:basics.mobile,onboarding,mft_account_complete:true}});
    if (error) throw error;
    if (!data.user) throw new Error('Account setup did not finish. Please try again.');
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
      mirrorUser(user); renderAccountProfile(user); authScreen.classList.add('hidden'); appShell.classList.remove('hidden'); return;
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
        const name = value('authName'), mobile = value('authMobile');
        if (name.length < 2) throw new Error('Enter a display name of at least 2 characters.');
        if (mobile && !/^\+[1-9]\d{7,14}$/.test(mobile.replace(/[\s()-]/g,''))) throw new Error('Enter the mobile number with country code, such as +91 98765 43210.');
        basics = {name,mobile,language:value('authLanguage'),password:validatePasswords()};
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
