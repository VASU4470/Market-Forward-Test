(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const authScreen = document.getElementById('authScreen');
  const appShell = document.getElementById('appShell');
  const card = document.querySelector('.auth-card');
  const oldForm = document.getElementById('authForm');
  if (!authScreen || !appShell || !card || !oldForm) return;

  const configured = Boolean(
    cfg.supabaseUrl && cfg.supabasePublishableKey && window.supabase &&
    typeof window.supabase.createClient === 'function'
  );
  if (!configured) return;

  // Replace prototype form/button nodes so legacy local-auth listeners cannot fire.
  const form = oldForm.cloneNode(false);
  form.id = 'authForm';
  form.className = 'auth-v3-form';
  form.setAttribute('novalidate', '');
  oldForm.replaceWith(form);

  const oldSignOut = document.getElementById('signOutBtn');
  let signOutBtn = null;
  if (oldSignOut) {
    signOutBtn = oldSignOut.cloneNode(true);
    oldSignOut.replaceWith(signOutBtn);
  }

  const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });

  authScreen.classList.add('auth-live-v3');
  const title = card.querySelector('h2');
  const subtitle = card.querySelector('p.muted');
  const existingProfiles = document.getElementById('existingProfiles');
  if (existingProfiles) existingProfiles.innerHTML = '';

  let flow = 'signin';
  let method = 'email';
  let pendingIdentifier = '';
  let busy = false;

  const flowTabs = document.createElement('div');
  flowTabs.className = 'auth-flow-tabs';
  flowTabs.innerHTML = '<button class="auth-flow-tab active" type="button" data-flow="signin">SIGN IN</button><button class="auth-flow-tab" type="button" data-flow="signup">SIGN UP</button>';

  const methodTabs = document.createElement('div');
  methodTabs.className = 'auth-method-tabs';
  methodTabs.innerHTML = '<button class="auth-method-tab active" type="button" data-method="email">Email</button><button class="auth-method-tab" type="button" data-method="phone">Mobile</button>';

  const status = document.createElement('div');
  status.className = 'auth-status-v3 ready';
  form.before(flowTabs, methodTabs);
  form.after(status);

  function esc(value = '') {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
  function setStatus(message, state = 'ready') {
    status.className = `auth-status-v3 ${state}`;
    status.textContent = message;
  }
  function setBusy(next) {
    busy = next;
    card.classList.toggle('auth-busy', next);
  }
  function phoneField() {
    return '<label class="field-label"><span>Mobile number</span><div class="phone-field"><select id="authV4Country" aria-label="Country code"><option value="+91" selected>🇮🇳 +91</option><option value="+1">+1</option><option value="+44">+44</option><option value="+971">+971</option><option value="+65">+65</option></select><input id="authV4Phone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="98765 43210" /></div></label>';
  }
  function passwordField(id, label, autocomplete) {
    return `<label class="field-label"><span>${label}</span><div class="password-wrap"><input id="${id}" type="password" autocomplete="${autocomplete}" /><button class="password-toggle" type="button" data-toggle-password="${id}">SHOW</button></div></label>`;
  }
  function currentIdentifier() {
    if (method === 'email') return (document.getElementById('authV4Email')?.value || '').trim().toLowerCase();
    const code = document.getElementById('authV4Country')?.value || '+91';
    const digits = (document.getElementById('authV4Phone')?.value || '').replace(/\D/g, '');
    return `${code}${digits}`;
  }
  function validIdentifier(value) {
    return method === 'email' ? /^\S+@\S+\.\S+$/.test(value) : value.replace(/\D/g, '').length >= 10;
  }
  function clearAppProfile() {
    try {
      const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
      store.activeProfile = null;
      localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
    } catch (_) {}
  }
  function mirrorUser(user) {
    const key = String(user.email || user.phone || user.id).toLowerCase();
    const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
    if (!store.profiles) store.profiles = {};
    const prior = store.profiles[key] || {};
    const language = user.user_metadata?.preferred_language || prior.state?.language || 'en';
    store.profiles[key] = {
      id:key,
      name:user.user_metadata?.display_name || prior.name || (user.email ? user.email.split('@')[0] : 'User'),
      email:user.email || prior.email || '',
      phone:user.phone || prior.phone || '',
      createdAt:prior.createdAt || user.created_at || new Date().toISOString(),
      state:prior.state || {predictions:[],language},
      supabaseUserId:user.id,
      authProvider:'supabase',
      authVerified:true
    };
    store.profiles[key].state.language = language;
    store.activeProfile = key;
    localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
  }

  function renderEntry(message = '') {
    flowTabs.classList.remove('hidden');
    methodTabs.classList.remove('hidden');
    form.classList.remove('hidden');
    flowTabs.querySelectorAll('[data-flow]').forEach(b => b.classList.toggle('active', b.dataset.flow === flow));
    methodTabs.querySelectorAll('[data-method]').forEach(b => b.classList.toggle('active', b.dataset.method === method));

    if (flow === 'signin') {
      title.textContent = 'Welcome back.';
      subtitle.textContent = 'Sign in with your verified email address or mobile number and password.';
      form.innerHTML = `${method === 'email' ? '<label class="field-label"><span>Email</span><input id="authV4Email" type="email" autocomplete="email" placeholder="you@example.com" /></label>' : phoneField()}${passwordField('authV4Password','Password','current-password')}<button class="primary-btn" type="submit">SIGN IN <span>→</span></button><div class="auth-helper-v3">New here? Choose <strong>Sign Up</strong> to verify your identity and create an account.</div>`;
      setStatus(message || 'Only password sign-in opens the workspace.', message ? 'success' : 'ready');
    } else {
      title.textContent = 'Create your account.';
      subtitle.textContent = 'Verify your email or mobile number first. Then create your profile and password.';
      form.innerHTML = `${method === 'email' ? '<label class="field-label"><span>Email</span><input id="authV4Email" type="email" autocomplete="email" placeholder="you@example.com" /></label>' : phoneField()}<button class="primary-btn" type="submit">SEND VERIFICATION <span>→</span></button><div class="auth-helper-v3">Verification only confirms ownership. It does <strong>not</strong> open the Market Forward Test workspace.</div>`;
      setStatus(message || (method === 'email' ? 'Your current Supabase setup may send a confirmation link. After custom SMTP is configured, it can send a 6-digit OTP instead.' : 'Mobile signup sends an SMS OTP and requires an SMS provider in Supabase.'), message ? 'success' : 'ready');
    }
  }

  function wireOtp() {
    const inputs = [...form.querySelectorAll('[data-otp]')];
    inputs.forEach((input, i) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g,'').slice(-1);
        if (input.value && i < inputs.length - 1) inputs[i+1].focus();
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && i > 0) inputs[i-1].focus();
      });
      input.addEventListener('paste', e => {
        const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g,'').slice(0,6);
        if (!digits) return;
        e.preventDefault();
        digits.split('').forEach((d,j) => { if (inputs[j]) inputs[j].value=d; });
      });
    });
    inputs[0]?.focus();
  }

  function renderVerification(identifier) {
    pendingIdentifier = identifier;
    flowTabs.classList.add('hidden');
    methodTabs.classList.add('hidden');
    title.textContent = 'Verify your identity.';
    subtitle.textContent = method === 'email' ? 'Use the email verification you received. A 6-digit code works here; a confirmation link will return you to account setup.' : 'Enter the 6-digit code sent to your mobile number.';
    form.innerHTML = `<div class="otp-stage-v3"><span class="section-kicker">VERIFICATION</span><h3>Enter the 6-digit code</h3><p>Sent to ${esc(identifier)}</p><div class="otp-code-v3">${Array.from({length:6},(_,i)=>`<input maxlength="1" inputmode="numeric" autocomplete="${i===0?'one-time-code':'off'}" data-otp="${i}" aria-label="Digit ${i+1}" />`).join('')}</div><button class="primary-btn" type="submit">VERIFY <span>→</span></button><div class="auth-inline-actions"><button type="button" class="auth-text-btn" id="authV4Back">← Change ${method==='email'?'email':'number'}</button><button type="button" class="auth-text-btn" id="authV4Resend">Resend verification</button></div></div>`;
    wireOtp();
    setStatus('Verification does not grant app access. After verification you must create a password and complete your profile.', 'ready');
  }

  function renderComplete(user) {
    flow = 'signup';
    flowTabs.classList.add('hidden');
    methodTabs.classList.add('hidden');
    const identity = user.email || user.phone || pendingIdentifier || 'Verified identity';
    title.textContent = 'Finish creating your account.';
    subtitle.textContent = 'Your identity is verified. Create the details you will use for future sign-ins.';
    form.innerHTML = `<div class="complete-stage-v3"><span class="section-kicker">ACCOUNT DETAILS</span><h3>Verified: ${esc(identity)}</h3><p>You are still not signed into the workspace. Complete registration below.</p><label class="field-label"><span>Display name</span><input id="authV4Name" autocomplete="name" placeholder="Your name" /></label><label class="field-label"><span>Preferred language</span><select id="authV4Language"><option value="en">English</option><option value="ta">தமிழ்</option></select></label>${passwordField('authV4NewPassword','Create password','new-password')}${passwordField('authV4ConfirmPassword','Confirm password','new-password')}<div class="password-rules">Use at least 8 characters. A longer passphrase is recommended.</div><button class="primary-btn" type="submit">CREATE ACCOUNT <span>→</span></button></div>`;
    setStatus('Verified successfully. Finish registration to create your password.', 'success');
  }

  async function sendVerification(identifier) {
    const payload = method === 'email'
      ? {email:identifier, options:{shouldCreateUser:true, emailRedirectTo:window.location.origin}}
      : {phone:identifier, options:{shouldCreateUser:true}};
    const {error} = await client.auth.signInWithOtp(payload);
    if (error) throw error;
    localStorage.setItem('mftPendingSignup', JSON.stringify({method,identifier,at:Date.now()}));
    renderVerification(identifier);
  }

  async function verifyCode() {
    const token = [...form.querySelectorAll('[data-otp]')].map(x=>x.value).join('');
    if (!/^\d{6}$/.test(token)) throw new Error('Enter the complete 6-digit verification code.');
    const params = method === 'email' ? {email:pendingIdentifier,token,type:'email'} : {phone:pendingIdentifier,token,type:'sms'};
    const {data,error} = await client.auth.verifyOtp(params);
    if (error) throw error;
    const user = data.user || data.session?.user;
    if (!user) throw new Error('Verification did not return a user account.');
    if (user.user_metadata?.mft_account_complete === true) {
      await client.auth.signOut({scope:'local'});
      flow='signin';
      renderEntry();
      throw new Error('This account already exists. Sign in with your password.');
    }
    renderComplete(user);
  }

  async function completeAccount() {
    const name=(document.getElementById('authV4Name')?.value||'').trim();
    const language=document.getElementById('authV4Language')?.value||'en';
    const password=document.getElementById('authV4NewPassword')?.value||'';
    const confirm=document.getElementById('authV4ConfirmPassword')?.value||'';
    if (name.length<2) throw new Error('Enter your display name.');
    if (password.length<8) throw new Error('Use a password with at least 8 characters.');
    if (password!==confirm) throw new Error('The two passwords do not match.');
    const {data,error}=await client.auth.updateUser({password,data:{display_name:name,preferred_language:language,mft_account_complete:true}});
    if (error) throw error;
    if (!data.user) throw new Error('Could not finish account creation.');
    await client.auth.signOut({scope:'local'});
    clearAppProfile();
    localStorage.removeItem('mftPendingSignup');
    flow='signin';
    renderEntry('Account created successfully. Sign in with your password to continue.');
  }

  async function passwordSignIn() {
    const identifier=currentIdentifier();
    const password=document.getElementById('authV4Password')?.value||'';
    if (!validIdentifier(identifier)) throw new Error(`Enter a valid ${method==='email'?'email address':'mobile number'}.`);
    if (!password) throw new Error('Enter your password.');
    const credentials=method==='email'?{email:identifier,password}:{phone:identifier,password};
    const {data,error}=await client.auth.signInWithPassword(credentials);
    if (error) throw error;
    const user=data.user||data.session?.user;
    if (!user) throw new Error('Sign in did not return a user account.');
    if (user.user_metadata?.mft_account_complete!==true) {
      await client.auth.signOut({scope:'local'});
      throw new Error('This registration is incomplete. Choose Sign Up and finish verification/account setup.');
    }
    mirrorUser(user);
    window.location.reload();
  }

  async function handleVerificationLink() {
    const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
    const accessToken=hash.get('access_token');
    const refreshToken=hash.get('refresh_token');
    const type=hash.get('type');
    if (!accessToken||!refreshToken||!['signup','magiclink'].includes(type||'')) return false;
    window.history.replaceState({},document.title,window.location.pathname+window.location.search);
    const {data,error}=await client.auth.setSession({access_token:accessToken,refresh_token:refreshToken});
    if (error) { setStatus(error.message||'Could not verify this link.','error'); return true; }
    const user=data.user||data.session?.user;
    if (!user) return true;
    if (user.user_metadata?.mft_account_complete===true) {
      await client.auth.signOut({scope:'local'});
      flow='signin'; method=user.email?'email':'phone';
      renderEntry();
      setStatus('This identity is already registered. Sign in with your password.','error');
      return true;
    }
    method=user.email?'email':'phone';
    pendingIdentifier=user.email||user.phone||'';
    clearAppProfile();
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    renderComplete(user);
    return true;
  }

  async function enforceSession() {
    if (await handleVerificationLink()) return;
    const {data}=await client.auth.getSession();
    const user=data?.session?.user;
    if (!user) {
      clearAppProfile();
      authScreen.classList.remove('hidden');
      appShell.classList.add('hidden');
      renderEntry();
      return;
    }
    if (user.user_metadata?.mft_account_complete===true) {
      mirrorUser(user);
      authScreen.classList.add('hidden');
      appShell.classList.remove('hidden');
      return;
    }
    method=user.email?'email':'phone';
    pendingIdentifier=user.email||user.phone||'';
    clearAppProfile();
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    renderComplete(user);
  }

  flowTabs.addEventListener('click',e=>{
    const b=e.target.closest('[data-flow]'); if(!b||busy)return;
    flow=b.dataset.flow==='signup'?'signup':'signin'; renderEntry();
  });
  methodTabs.addEventListener('click',e=>{
    const b=e.target.closest('[data-method]'); if(!b||busy)return;
    method=b.dataset.method==='phone'?'phone':'email'; renderEntry();
  });
  form.addEventListener('click',e=>{
    const toggle=e.target.closest('[data-toggle-password]');
    if(toggle){const input=document.getElementById(toggle.dataset.togglePassword);if(input){input.type=input.type==='password'?'text':'password';toggle.textContent=input.type==='password'?'SHOW':'HIDE';}return;}
    if(e.target.id==='authV4Back'){renderEntry();return;}
    if(e.target.id==='authV4Resend'){
      e.preventDefault(); if(!pendingIdentifier||busy)return; setBusy(true);
      sendVerification(pendingIdentifier).then(()=>setStatus('A new verification message was sent.','success')).catch(err=>setStatus(err.message||'Could not resend verification.','error')).finally(()=>setBusy(false));
    }
  });
  form.addEventListener('submit',async e=>{
    e.preventDefault(); if(busy)return; setBusy(true);
    try{
      if(flow==='signin'){await passwordSignIn();return;}
      if(document.getElementById('authV4NewPassword')){await completeAccount();return;}
      if(form.querySelector('[data-otp]')){await verifyCode();return;}
      const identifier=currentIdentifier();
      if(!validIdentifier(identifier))throw new Error(`Enter a valid ${method==='email'?'email address':'mobile number'}.`);
      await sendVerification(identifier);
    }catch(err){setStatus(err?.message||'Authentication could not be completed.','error');}
    finally{setBusy(false);}
  });

  signOutBtn?.addEventListener('click',async()=>{
    try{await client.auth.signOut({scope:'local'});}catch(_){}
    clearAppProfile(); flow='signin'; method='email';
    authScreen.classList.remove('hidden'); appShell.classList.add('hidden'); renderEntry('You have been signed out.');
  });

  enforceSession().catch(()=>{
    clearAppProfile(); authScreen.classList.remove('hidden'); appShell.classList.add('hidden'); renderEntry();
    setStatus('Authentication service is temporarily unavailable. Please try again.','error');
  });
})();
