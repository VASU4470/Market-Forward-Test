(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const authScreen = document.getElementById('authScreen');
  const appShell = document.getElementById('appShell');
  const form = document.getElementById('authForm');
  const card = document.querySelector('.auth-card');
  if (!authScreen || !form || !card) return;

  const configured = Boolean(
    cfg.supabaseUrl && cfg.supabasePublishableKey &&
    window.supabase && typeof window.supabase.createClient === 'function'
  );

  const FLOW_VERSION = 'otp-only-v2';

  // Remove any old magic-link tokens from the URL before Supabase can consume them.
  if (window.location.hash && /(?:access_token|refresh_token|type=signup|type=magiclink)/i.test(window.location.hash)) {
    history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }

  // One-time beta migration: clear sessions created by the earlier magic-link flow.
  if (configured) {
    try {
      if (localStorage.getItem('mftAuthFlowVersion') !== FLOW_VERSION) {
        const projectRef = new URL(cfg.supabaseUrl).hostname.split('.')[0];
        if (projectRef) localStorage.removeItem(`sb-${projectRef}-auth-token`);
        const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
        store.activeProfile = null;
        localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
        localStorage.setItem('mftAuthFlowVersion', FLOW_VERSION);
      }
    } catch (_) {}
  }

  const client = configured ? window.supabase.createClient(
    cfg.supabaseUrl,
    cfg.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false
      }
    }
  ) : null;

  let method = 'email';
  let pendingIdentifier = '';
  let sending = false;

  authScreen.classList.add(configured ? 'auth-live' : 'auth-local-only');

  const nameInput = document.getElementById('authName');
  const emailInput = document.getElementById('authEmail');
  const nameRow = nameInput?.closest('label');
  const emailRow = emailInput?.closest('label');
  if (nameRow) {
    nameRow.id = 'authNameRow';
    if (configured) nameRow.classList.add('hidden');
  }

  const existingProfiles = document.getElementById('existingProfiles');
  if (configured && existingProfiles) existingProfiles.classList.add('hidden');

  const tabs = document.createElement('div');
  tabs.className = 'auth-mode-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = `
    <button class="auth-mode-tab active" type="button" role="tab" aria-selected="true" data-auth-method="email">
      <svg viewBox="0 0 24 24"><path d="M3 6.5h18v11H3zM4 7l8 6 8-6"/></svg><span>Email</span>
    </button>
    <button class="auth-mode-tab" type="button" role="tab" aria-selected="false" data-auth-method="phone">
      <svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10 18.5h4"/></svg><span>Mobile</span>
    </button>`;
  form.before(tabs);

  const emailPanel = document.createElement('div');
  emailPanel.className = 'auth-panel active';
  emailPanel.dataset.authPanel = 'email';
  if (emailRow) emailPanel.appendChild(emailRow);
  form.insertBefore(emailPanel, form.querySelector('.primary-btn'));

  const phonePanel = document.createElement('div');
  phonePanel.className = 'auth-panel';
  phonePanel.dataset.authPanel = 'phone';
  phonePanel.innerHTML = `
    <label class="field-label"><span>Mobile number</span>
      <div class="phone-field">
        <select id="authCountryCode" aria-label="Country code">
          <option value="+91" selected>🇮🇳 +91</option>
          <option value="+1">+1</option>
          <option value="+44">+44</option>
          <option value="+971">+971</option>
          <option value="+65">+65</option>
        </select>
        <input id="authPhone" type="tel" inputmode="tel" autocomplete="tel-national" placeholder="98765 43210" />
      </div>
    </label>
    <div class="auth-helper"><span class="auth-helper-dot"></span><span>Your number is used only for authentication. SMS delivery requires the configured provider.</span></div>`;
  form.insertBefore(phonePanel, form.querySelector('.primary-btn'));

  const submit = form.querySelector('.primary-btn');
  const status = document.createElement('div');
  status.className = `auth-status ${configured ? 'ready' : ''}`;
  form.after(status);

  const security = document.createElement('div');
  security.className = 'auth-security-row';
  security.innerHTML = `
    <span><span class="auth-security-icon">◇</span><span>Passwordless OTP sign-in</span></span>
    <b>${configured ? 'AUTH CONNECTED' : 'LOCAL BETA MODE'}</b>`;
  status.after(security);

  const otpStage = document.createElement('div');
  otpStage.className = 'otp-stage hidden';
  otpStage.innerHTML = `
    <span class="section-kicker">VERIFY IDENTITY</span>
    <h3>Enter the 6-digit code</h3>
    <p id="otpDestination">We sent a verification code.</p>
    <form id="otpForm" novalidate>
      <div class="otp-code" aria-label="One-time password">
        ${Array.from({length: 6}, (_, i) => `<input data-otp-index="${i}" maxlength="1" inputmode="numeric" pattern="[0-9]*" autocomplete="${i === 0 ? 'one-time-code' : 'off'}" aria-label="Digit ${i + 1}" />`).join('')}
      </div>
      <button class="primary-btn" id="verifyOtpBtn" type="submit">VERIFY & SIGN IN <span>→</span></button>
      <div class="otp-actions">
        <button class="auth-back-btn" id="otpBackBtn" type="button">← Change email</button>
        <button class="auth-back-btn" id="resendOtpBtn" type="button">Resend code</button>
      </div>
    </form>`;
  security.after(otpStage);

  function setStatus(message, state = '') {
    status.className = `auth-status ${state}`.trim();
    status.textContent = message;
  }

  function submitLabel() {
    if (!submit) return;
    if (!configured) {
      submit.innerHTML = method === 'email' ? 'CONTINUE IN LOCAL BETA <span>→</span>' : 'CONNECT AUTH BACKEND <span>→</span>';
    } else {
      submit.innerHTML = `SEND ${method === 'email' ? 'EMAIL' : 'SMS'} CODE <span>→</span>`;
    }
  }

  function defaultStatus() {
    setStatus(
      configured
        ? 'Enter your email or mobile number. You must verify the one-time code before the workspace opens.'
        : 'OTP authentication is not configured yet. Local beta sign-in remains available.',
      configured ? 'ready' : ''
    );
  }

  function setMethod(next) {
    method = next === 'phone' ? 'phone' : 'email';
    tabs.querySelectorAll('[data-auth-method]').forEach(btn => {
      const active = btn.dataset.authMethod === method;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-auth-panel]').forEach(panel => {
      panel.classList.toggle('active', panel.dataset.authPanel === method);
    });
    if (emailInput) {
      emailInput.disabled = method !== 'email';
      emailInput.required = method === 'email';
    }
    const phone = document.getElementById('authPhone');
    if (phone) phone.required = method === 'phone';
    submitLabel();
    const back = document.getElementById('otpBackBtn');
    if (back) back.textContent = `← Change ${method === 'email' ? 'email' : 'number'}`;
  }

  tabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-auth-method]');
    if (btn) setMethod(btn.dataset.authMethod);
  });

  function phoneIdentifier() {
    const code = document.getElementById('authCountryCode')?.value || '+91';
    const digits = (document.getElementById('authPhone')?.value || '').replace(/\D/g, '');
    return `${code}${digits}`;
  }

  async function requestOtp() {
    if (!configured || sending) return;
    const identifier = method === 'email'
      ? (emailInput?.value || '').trim().toLowerCase()
      : phoneIdentifier();

    if (method === 'email' && !/^\S+@\S+\.\S+$/.test(identifier)) {
      setStatus('Enter a valid email address.', 'error');
      return;
    }
    if (method === 'phone' && identifier.replace(/\D/g, '').length < 10) {
      setStatus('Enter a valid mobile number including the country code.', 'error');
      return;
    }

    sending = true;
    submit.disabled = true;
    submit.textContent = 'SENDING CODE…';
    try {
      const payload = method === 'email'
        ? { email: identifier, options: { shouldCreateUser: true } }
        : { phone: identifier, options: { shouldCreateUser: true } };
      const { error } = await client.auth.signInWithOtp(payload);
      if (error) throw error;
      pendingIdentifier = identifier;
      form.classList.add('hidden');
      tabs.classList.add('hidden');
      otpStage.classList.remove('hidden');
      document.getElementById('otpDestination').textContent = `Code sent to ${identifier}. Enter it below to continue.`;
      setStatus('Verification code requested. If no numeric code arrives, the Supabase email/SMS template is not configured for OTP yet.', 'success');
      otpStage.querySelector('[data-otp-index="0"]')?.focus();
    } catch (err) {
      setStatus(err?.message || 'Unable to send the verification code.', 'error');
    } finally {
      sending = false;
      submit.disabled = false;
      submitLabel();
    }
  }

  form.addEventListener('submit', async e => {
    if (!configured) {
      if (method === 'phone') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setStatus('Mobile OTP requires Supabase and an SMS provider.', 'error');
      }
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    await requestOtp();
  }, true);

  document.getElementById('otpForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    if (!configured || !pendingIdentifier) return;
    const token = [...otpStage.querySelectorAll('[data-otp-index]')].map(input => input.value).join('');
    if (!/^\d{6}$/.test(token)) {
      setStatus('Enter the complete 6-digit verification code.', 'error');
      return;
    }

    const verifyBtn = document.getElementById('verifyOtpBtn');
    verifyBtn.disabled = true;
    verifyBtn.textContent = 'VERIFYING…';
    try {
      const params = method === 'email'
        ? { email: pendingIdentifier, token, type: 'email' }
        : { phone: pendingIdentifier, token, type: 'sms' };
      const { data, error } = await client.auth.verifyOtp(params);
      if (error) throw error;
      const user = data.user || data.session?.user;
      if (!user || !data.session) throw new Error('OTP verification did not create a valid session.');
      mirrorAuthenticatedUser(user);
      setStatus('Identity verified. Opening your workspace…', 'success');
      window.location.reload();
    } catch (err) {
      setStatus(err?.message || 'The code could not be verified. Request a new code and try again.', 'error');
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = 'VERIFY & SIGN IN <span>→</span>';
    }
  });

  function mirrorAuthenticatedUser(user) {
    const key = user.email || user.phone || user.id;
    const id = String(key).toLowerCase();
    const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
    if (!store.profiles) store.profiles = {};
    const existing = store.profiles[id] || {};
    const fallbackName = user.user_metadata?.display_name || user.user_metadata?.full_name || (user.email ? user.email.split('@')[0] : 'User');
    store.profiles[id] = {
      id,
      name: existing.name || fallbackName,
      email: user.email || existing.email || '',
      phone: user.phone || existing.phone || '',
      createdAt: existing.createdAt || user.created_at || new Date().toISOString(),
      state: existing.state || { predictions: [], language: 'en' },
      supabaseUserId: user.id,
      authProvider: 'supabase',
      authVerified: true
    };
    store.activeProfile = id;
    localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
  }

  function resetOtp() {
    pendingIdentifier = '';
    otpStage.querySelectorAll('[data-otp-index]').forEach(input => input.value = '');
    otpStage.classList.add('hidden');
    tabs.classList.remove('hidden');
    form.classList.remove('hidden');
    defaultStatus();
  }

  document.getElementById('otpBackBtn')?.addEventListener('click', resetOtp);
  document.getElementById('resendOtpBtn')?.addEventListener('click', async () => {
    if (!configured || !pendingIdentifier || sending) return;
    try {
      const payload = method === 'email' ? { email: pendingIdentifier } : { phone: pendingIdentifier };
      const { error } = await client.auth.signInWithOtp(payload);
      if (error) throw error;
      setStatus('A new verification code was requested.', 'success');
    } catch (err) {
      setStatus(err?.message || 'Unable to resend the code yet.', 'error');
    }
  });

  const otpInputs = [...otpStage.querySelectorAll('[data-otp-index]')];
  otpInputs.forEach((input, index) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && index < otpInputs.length - 1) otpInputs[index + 1].focus();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && index > 0) otpInputs[index - 1].focus();
    });
    input.addEventListener('paste', e => {
      const digits = (e.clipboardData?.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!digits) return;
      e.preventDefault();
      digits.split('').forEach((d, i) => { if (otpInputs[i]) otpInputs[i].value = d; });
      otpInputs[Math.min(digits.length, 6) - 1]?.focus();
    });
  });

  document.getElementById('signOutBtn')?.addEventListener('click', async e => {
    if (!configured) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    try { await client.auth.signOut({ scope: 'local' }); } catch (_) {}
    try {
      const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
      store.activeProfile = null;
      localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
    } catch (_) {}
    window.location.reload();
  }, true);

  async function enforceSecureSession() {
    if (!configured) {
      defaultStatus();
      return;
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const session = data?.session;
      if (session?.user) {
        mirrorAuthenticatedUser(session.user);
        const identity = session.user.email || session.user.phone || '';
        const profileEmail = document.getElementById('profileEmail');
        const editEmail = document.getElementById('editEmail');
        if (profileEmail && identity) profileEmail.textContent = identity;
        if (editEmail) {
          editEmail.value = session.user.email || '';
          editEmail.readOnly = true;
          editEmail.title = 'Authentication email is managed by your verified account.';
        }
        authScreen.classList.add('hidden');
        appShell?.classList.remove('hidden');
        return;
      }

      try {
        const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
        store.activeProfile = null;
        localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
      } catch (_) {}
      authScreen.classList.remove('hidden');
      appShell?.classList.add('hidden');
      defaultStatus();
    } catch (_) {
      authScreen.classList.remove('hidden');
      appShell?.classList.add('hidden');
      setStatus('Authentication service is temporarily unavailable. Please try again.', 'error');
    }
  }

  setMethod('email');
  defaultStatus();
  enforceSecureSession();
})();
