(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const authScreen = document.getElementById('authScreen');
  const appShell = document.getElementById('appShell');
  const card = document.querySelector('.auth-card');
  const legacyForm = document.getElementById('authForm');
  if (!authScreen || !appShell || !card || !legacyForm) return;

  const configured = Boolean(
    cfg.supabaseUrl && cfg.supabasePublishableKey && window.supabase &&
    typeof window.supabase.createClient === 'function'
  );
  if (!configured) return;

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
  flowTabs.innerHTML = `
    <button class="auth-flow-tab active" type="button" data-flow="signin">SIGN IN</button>
    <button class="auth-flow-tab" type="button" data-flow="signup">SIGN UP</button>`;

  const methodTabs = document.createElement('div');
  methodTabs.className = 'auth-method-tabs';
  methodTabs.innerHTML = `
    <button class="auth-method-tab active" type="button" data-method="email">Email</button>
    <button class="auth-method-tab" type="button" data-method="phone">Mobile</button>`;

  const status = document.createElement('div');
  status.className = 'auth-status-v3 ready';

  legacyForm.replaceChildren();
  legacyForm.className = 'auth-v3-form';
  legacyForm.setAttribute('novalidate', '');
  legacyForm.before(flowTabs, methodTabs);
  legacyForm.after(status);

  function setStatus(message, state = 'ready') {
    status.className = `auth-status-v3 ${state}`;
    status.textContent = message;
  }

  function setBusy(next) {
    busy = next;
    card.classList.toggle('auth-busy', next);
  }

  function phoneField(id = 'authV3Phone') {
    return `
      <label class="field-label"><span>Mobile number</span>
        <div class="phone-field">
          <select id="authV3Country" aria-label="Country code">
            <option value="+91" selected>🇮🇳 +91</option>
            <option value="+1">+1</option>
            <option value="+44">+44</option>
            <option value="+971">+971</option>
            <option value="+65">+65</option>
          </select>
          <input id="${id}" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="98765 43210" />
        </div>
      </label>`;
  }

  function passwordField(id, label, autocomplete = 'current-password') {
    return `
      <label class="field-label"><span>${label}</span>
        <div class="password-wrap">
          <input id="${id}" type="password" autocomplete="${autocomplete}" />
          <button class="password-toggle" type="button" data-toggle-password="${id}">SHOW</button>
        </div>
      </label>`;
  }

  function normalizedPhone(inputId = 'authV3Phone') {
    const code = document.getElementById('authV3Country')?.value || '+91';
    const digits = (document.getElementById(inputId)?.value || '').replace(/\D/g, '');
    return `${code}${digits}`;
  }

  function identifierFromForm() {
    if (method === 'email') return (document.getElementById('authV3Email')?.value || '').trim().toLowerCase();
    return normalizedPhone();
  }

  function validateIdentifier(identifier) {
    if (method === 'email') return /^\S+@\S+\.\S+$/.test(identifier);
    return identifier.replace(/\D/g, '').length >= 10;
  }

  function renderEntry() {
    flowTabs.classList.remove('hidden');
    methodTabs.classList.remove('hidden');
    legacyForm.classList.remove('hidden');

    flowTabs.querySelectorAll('[data-flow]').forEach(btn => btn.classList.toggle('active', btn.dataset.flow === flow));
    methodTabs.querySelectorAll('[data-method]').forEach(btn => btn.classList.toggle('active', btn.dataset.method === method));

    if (flow === 'signin') {
      title.textContent = 'Welcome back.';
      subtitle.textContent = 'Sign in with the email address or mobile number linked to your account.';
      legacyForm.innerHTML = `
        ${method === 'email' ? '<label class="field-label"><span>Email</span><input id="authV3Email" type="email" autocomplete="email" placeholder="you@example.com" /></label>' : phoneField()}
        ${passwordField('authV3Password', 'Password')}
        <button class="primary-btn" type="submit">SIGN IN <span>→</span></button>
        <div class="auth-helper-v3">New here? Choose <strong>Sign Up</strong> above to verify your email or mobile number and create an account.</div>`;
      setStatus('Password sign-in is required for access to your Market Forward Test workspace.', 'ready');
    } else {
      title.textContent = 'Create your account.';
      subtitle.textContent = 'First verify your email or mobile number. After verification, you will create your password and profile.';
      legacyForm.innerHTML = `
        ${method === 'email' ? '<label class="field-label"><span>Email</span><input id="authV3Email" type="email" autocomplete="email" placeholder="you@example.com" /></label>' : phoneField()}
        <button class="primary-btn" type="submit">SEND VERIFICATION <span>→</span></button>
        <div class="auth-helper-v3">Verification does <strong>not</strong> sign you into the app. It only confirms that this ${method === 'email' ? 'email address' : 'mobile number'} belongs to you.</div>`;
      setStatus(method === 'email' ? 'We will send either a 6-digit code or a confirmation link, depending on your Supabase email template.' : 'We will send an SMS verification code. Phone authentication requires an SMS provider in Supabase.', 'ready');
    }
  }

  function clearAppProfile() {
    try {
      const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
      store.activeProfile = null;
      localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
    } catch (_) {}
  }

  function mirrorAuthenticatedUser(user) {
    const key = String(user.email || user.phone || user.id).toLowerCase();
    const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
    if (!store.profiles) store.profiles = {};
    const existing = store.profiles[key] || {};
    const name = user.user_metadata?.display_name || existing.name || (user.email ? user.email.split('@')[0] : 'User');
    store.profiles[key] = {
      id: key,
      name,
      email: user.email || existing.email || '',
      phone: user.phone || existing.phone || '',
      createdAt: existing.createdAt || user.created_at || new Date().toISOString(),
      state: existing.state || { predictions: [], language: user.user_metadata?.preferred_language || 'en' },
      supabaseUserId: user.id,
      authProvider: 'supabase',
      authVerified: true
    };
    if (user.user_metadata?.preferred_language) store.profiles[key].state.language = user.user_metadata.preferred_language;
    store.activeProfile = key;
    localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
  }

  function renderOtp(identifier) {
    pendingIdentifier = identifier;
    flowTabs.classList.add('hidden');
    methodTabs.classList.add('hidden');
    legacyForm.classList.remove('hidden');
    title.textContent = 'Verify your identity.';
    subtitle.textContent = method === 'email'
      ? 'Enter the six-digit code from your email. If your project still uses the default Supabase template, use the confirmation link instead.'
      : 'Enter the six-digit verification code sent to your mobile number.';
    legacyForm.innerHTML = `
      <div class="otp-stage-v3">
        <span class="section-kicker">VERIFICATION</span>
        <h3>Enter the 6-digit code</h3>
        <p>Sent to ${escapeHtml(identifier)}</p>
        <div class="otp-code-v3">
          ${Array.from({length: 6}, (_, i) => `<input maxlength="1" inputmode="numeric" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" data-otp="${i}" aria-label="Digit ${i + 1}" />`).join('')}
        </div>
        <button class="primary-btn" type="submit">VERIFY <span>→</span></button>
        <div class="auth-inline-actions"><button type="button" class="auth-text-btn" id="authV3Back">← Change ${method === 'email' ? 'email' : 'number'}</button><button type="button" class="auth-text-btn" id="authV3Resend">Resend verification</button></div>
      </div>`;
    wireOtpInputs();
    setStatus('Verification is required before you can create your password and profile.', 'ready');
  }

  function renderCompleteProfile(user) {
    flow = 'signup';
    flowTabs.classList.add('hidden');
    methodTabs.classList.add('hidden');
    legacyForm.classList.remove('hidden');
    const identity = user.email || user.phone || pendingIdentifier || 'Verified identity';
    title.textContent = 'Finish creating your account.';
    subtitle.textContent = 'Your identity is verified. Now create the details you will use for future sign-ins.';
    legacyForm.innerHTML = `
      <div class="complete-stage-v3">
        <span class="section-kicker">ACCOUNT DETAILS</span>
        <h3>Verified: ${escapeHtml(identity)}</h3>
        <p>Verification alone does not grant workspace access. Complete your profile and create a password.</p>
        <label class="field-label"><span>Display name</span><input id="authV3Name" autocomplete="name" placeholder="Your name" /></label>
        <label class="field-label"><span>Preferred language</span>
          <select id="authV3Language">
            <option value="en">English</option>
            <option value="ta">தமிழ்</option>
          </select>
        </label>
        ${passwordField('authV3NewPassword', 'Create password', 'new-password')}
        ${passwordField('authV3ConfirmPassword', 'Confirm password', 'new-password')}
        <div class="password-rules">Use at least 8 characters. A longer passphrase is recommended.</div>
        <button class="primary-btn" type="submit">CREATE ACCOUNT <span>→</span></button>
      </div>`;
    setStatus('Identity verified. Complete these details to finish registration.', 'success');
  }

  function renderAccountCreated() {
    flow = 'signin';
    methodTabs.classList.remove('hidden');
    flowTabs.classList.remove('hidden');
    legacyForm.classList.remove('hidden');
    title.textContent = 'Account created.';
    subtitle.textContent = 'Your verification and profile setup are complete.';
    legacyForm.innerHTML = `<div class="account-created">Your account is ready. Sign in with your ${method === 'email' ? 'email address' : 'mobile number'} and the password you just created.</div><button class="primary-btn" type="button" id="authV3GoSignIn">GO TO SIGN IN <span>→</span></button>`;
    setStatus('For security, registration ended with a sign-out. Your next step is a normal password sign-in.', 'success');
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function wireOtpInputs() {
    const inputs = [...legacyForm.querySelectorAll('[data-otp]')];
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(-1);
        if (input.value && index < inputs.length - 1) inputs[index + 1].focus();
      });
      input.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !input.value && index > 0) inputs[index - 1].focus();
      });
      input.addEventListener('paste', e => {
        const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!digits) return;
        e.preventDefault();
        digits.split('').forEach((digit, i) => { if (inputs[i]) inputs[i].value = digit; });
      });
    });
    inputs[0]?.focus();
  }

  async function requestVerification(identifier) {
    const payload = method === 'email'
      ? { email: identifier, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } }
      : { phone: identifier, options: { shouldCreateUser: true } };
    const { error } = await client.auth.signInWithOtp(payload);
    if (error) throw error;
    try { localStorage.setItem('mftPendingSignup', JSON.stringify({method, identifier, at:Date.now()})); } catch (_) {}
    renderOtp(identifier);
  }

  async function verifyCode() {
    const token = [...legacyForm.querySelectorAll('[data-otp]')].map(x => x.value).join('');
    if (!/^\d{6}$/.test(token)) throw new Error('Enter the complete 6-digit verification code.');
    const params = method === 'email'
      ? { email: pendingIdentifier, token, type: 'email' }
      : { phone: pendingIdentifier, token, type: 'sms' };
    const { data, error } = await client.auth.verifyOtp(params);
    if (error) throw error;
    const user = data.user || data.session?.user;
    if (!user) throw new Error('Verification succeeded but no account session was returned.');
    if (user.user_metadata?.mft_account_complete === true) {
      await client.auth.signOut({scope:'local'});
      throw new Error('An account already exists for this identity. Use Sign In with your password.');
    }
    renderCompleteProfile(user);
  }

  async function completeAccount() {
    const name = (document.getElementById('authV3Name')?.value || '').trim();
    const language = document.getElementById('authV3Language')?.value || 'en';
    const password = document.getElementById('authV3NewPassword')?.value || '';
    const confirm = document.getElementById('authV3ConfirmPassword')?.value || '';
    if (name.length < 2) throw new Error('Enter your display name.');
    if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
    if (password !== confirm) throw new Error('The two passwords do not match.');

    const { data, error } = await client.auth.updateUser({
      password,
      data: { display_name: name, preferred_language: language, mft_account_complete: true }
    });
    if (error) throw error;
    if (!data.user) throw new Error('Could not finish creating the account.');
    await client.auth.signOut({scope:'local'});
    clearAppProfile();
    localStorage.removeItem('mftPendingSignup');
    renderAccountCreated();
  }

  async function signInWithPassword() {
    const identifier = identifierFromForm();
    const password = document.getElementById('authV3Password')?.value || '';
    if (!validateIdentifier(identifier)) throw new Error(`Enter a valid ${method === 'email' ? 'email address' : 'mobile number'}.`);
    if (!password) throw new Error('Enter your password.');
    const credentials = method === 'email' ? {email:identifier, password} : {phone:identifier, password};
    const { data, error } = await client.auth.signInWithPassword(credentials);
    if (error) throw error;
    const user = data.user || data.session?.user;
    if (!user) throw new Error('Sign in did not return a user account.');
    if (user.user_metadata?.mft_account_complete !== true) {
      await client.auth.signOut({scope:'local'});
      throw new Error('This registration is not complete yet. Choose Sign Up and finish verification/account setup.');
    }
    mirrorAuthenticatedUser(user);
    window.location.reload();
  }

  async function handleMagicLinkVerification() {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    const type = hash.get('type');
    if (!accessToken || !refreshToken || !['signup','magiclink'].includes(type || '')) return false;

    window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
    const { data, error } = await client.auth.setSession({access_token:accessToken, refresh_token:refreshToken});
    if (error) {
      setStatus(error.message || 'Could not verify the email link.', 'error');
      return true;
    }
    const user = data.user || data.session?.user;
    if (!user) return true;
    if (user.user_metadata?.mft_account_complete === true) {
      await client.auth.signOut({scope:'local'});
      setStatus('This email is already registered. Please use Sign In with your password.', 'error');
      flow = 'signin';
      renderEntry();
      return true;
    }
    method = user.email ? 'email' : 'phone';
    pendingIdentifier = user.email || user.phone || '';
    renderCompleteProfile(user);
    return true;
  }

  async function enforceSession() {
    const fromLink = await handleMagicLinkVerification();
    if (fromLink) return;
    const { data } = await client.auth.getSession();
    const session = data?.session;
    if (!session?.user) {
      clearAppProfile();
      authScreen.classList.remove('hidden');
      appShell.classList.add('hidden');
      renderEntry();
      return;
    }
    const user = session.user;
    if (user.user_metadata?.mft_account_complete === true) {
      mirrorAuthenticatedUser(user);
      authScreen.classList.add('hidden');
      appShell.classList.remove('hidden');
      return;
    }
    method = user.email ? 'email' : 'phone';
    pendingIdentifier = user.email || user.phone || '';
    clearAppProfile();
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    renderCompleteProfile(user);
  }

  flowTabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-flow]');
    if (!btn || busy) return;
    flow = btn.dataset.flow === 'signup' ? 'signup' : 'signin';
    renderEntry();
  });
  methodTabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-method]');
    if (!btn || busy) return;
    method = btn.dataset.method === 'phone' ? 'phone' : 'email';
    renderEntry();
  });

  legacyForm.addEventListener('click', e => {
    const toggle = e.target.closest('[data-toggle-password]');
    if (toggle) {
      const input = document.getElementById(toggle.dataset.togglePassword);
      if (input) {
        input.type = input.type === 'password' ? 'text' : 'password';
        toggle.textContent = input.type === 'password' ? 'SHOW' : 'HIDE';
      }
      return;
    }
    if (e.target.id === 'authV3Back') { renderEntry(); return; }
    if (e.target.id === 'authV3GoSignIn') { flow = 'signin'; renderEntry(); return; }
    if (e.target.id === 'authV3Resend') {
      e.preventDefault();
      if (!pendingIdentifier || busy) return;
      setBusy(true);
      requestVerification(pendingIdentifier)
        .then(() => setStatus('A new verification message was sent.', 'success'))
        .catch(err => setStatus(err.message || 'Could not resend verification.', 'error'))
        .finally(() => setBusy(false));
    }
  });

  legacyForm.addEventListener('submit', async e => {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (busy) return;
    setBusy(true);
    try {
      if (flow === 'signin') {
        await signInWithPassword();
        return;
      }
      if (legacyForm.querySelector('[data-otp]')) {
        await verifyCode();
        return;
      }
      if (document.getElementById('authV3NewPassword')) {
        await completeAccount();
        return;
      }
      const identifier = identifierFromForm();
      if (!validateIdentifier(identifier)) throw new Error(`Enter a valid ${method === 'email' ? 'email address' : 'mobile number'}.`);
      await requestVerification(identifier);
    } catch (err) {
      setStatus(err?.message || 'Authentication could not be completed.', 'error');
    } finally {
      setBusy(false);
    }
  }, true);

  document.addEventListener('click', async e => {
    const signOut = e.target.closest('#signOutBtn');
    if (!signOut) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { await client.auth.signOut({scope:'local'}); } catch (_) {}
    clearAppProfile();
    flow = 'signin'; method = 'email';
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    renderEntry();
    setStatus('You have been signed out.', 'success');
  }, true);

  // Stop the legacy local-profile auth handler from ever authenticating a cloud account.
  document.addEventListener('submit', e => {
    if (e.target === legacyForm) e.stopImmediatePropagation();
  }, true);

  enforceSession().catch(() => {
    clearAppProfile();
    authScreen.classList.remove('hidden');
    appShell.classList.add('hidden');
    renderEntry();
    setStatus('Authentication service is temporarily unavailable. Please try again.', 'error');
  });
})();
