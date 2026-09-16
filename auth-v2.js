(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const authScreen = document.getElementById('authScreen');
  const form = document.getElementById('authForm');
  const card = document.querySelector('.auth-card');
  if (!authScreen || !form || !card) return;

  const configured = Boolean(
    cfg.supabaseUrl &&
    cfg.supabasePublishableKey &&
    window.supabase &&
    typeof window.supabase.createClient === 'function'
  );
  const client = configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey)
    : null;

  let method = 'email';
  let pendingIdentifier = '';
  let sending = false;

  authScreen.classList.add(configured ? 'auth-live' : 'auth-local-only');

  const nameInput = document.getElementById('authName');
  const emailInput = document.getElementById('authEmail');
  const nameRow = nameInput?.closest('label');
  const emailRow = emailInput?.closest('label');
  if (nameRow) nameRow.id = 'authNameRow';

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
    <div class="auth-helper"><span class="auth-helper-dot"></span><span>We use your number only for authentication. Standard SMS charges may apply.</span></div>`;
  form.insertBefore(phonePanel, form.querySelector('.primary-btn'));

  const submit = form.querySelector('.primary-btn');
  const submitLabel = () => {
    if (!submit) return;
    if (!configured) {
      submit.innerHTML = method === 'email' ? 'CONTINUE IN LOCAL BETA <span>→</span>' : 'CONNECT AUTH BACKEND <span>→</span>';
      return;
    }
    submit.innerHTML = `SEND ${method === 'email' ? 'EMAIL' : 'SMS'} CODE <span>→</span>`;
  };

  const status = document.createElement('div');
  status.className = `auth-status ${configured ? 'ready' : ''}`;
  status.textContent = configured
    ? 'Secure passwordless authentication is connected. We will send a one-time verification code.'
    : 'OTP authentication UI is ready. Connect Supabase to activate email and mobile verification.';
  form.after(status);

  const security = document.createElement('div');
  security.className = 'auth-security-row';
  security.innerHTML = `
    <span><span class="auth-security-icon">◇</span><span>Passwordless sign-in</span></span>
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
        <button class="auth-back-btn" id="otpBackBtn" type="button">← Change ${method === 'email' ? 'email' : 'number'}</button>
        <button class="auth-back-btn" id="resendOtpBtn" type="button">Resend code</button>
      </div>
    </form>`;
  security.after(otpStage);

  function setStatus(message, state = '') {
    status.className = `auth-status ${state}`.trim();
    status.textContent = message;
  }

  function setMethod(next) {
    method = next === 'phone' ? 'phone' : 'email';
    tabs.querySelectorAll('[data-auth-method]').forEach(btn => {
      const active = btn.dataset.authMethod === method;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-auth-panel]').forEach(panel => panel.classList.toggle('active', panel.dataset.authPanel === method));
    if (emailInput) {
      emailInput.disabled = method !== 'email';
      emailInput.required = method === 'email' && !configured;
    }
    const phone = document.getElementById('authPhone');
    if (phone) phone.required = method === 'phone';
    if (nameInput) nameInput.required = !configured && method === 'email';
    submitLabel();
    const back = document.getElementById('otpBackBtn');
    if (back) back.textContent = `← Change ${method === 'email' ? 'email' : 'number'}`;
  }

  tabs.addEventListener('click', e => {
    const btn = e.target.closest('[data-auth-method]');
    if (!btn) return;
    setMethod(btn.dataset.authMethod);
  });

  function phoneIdentifier() {
    const code = document.getElementById('authCountryCode')?.value || '+91';
    const raw = document.getElementById('authPhone')?.value || '';
    const digits = raw.replace(/\D/g, '');
    return `${code}${digits}`;
  }

  async function requestOtp() {
    if (!configured || sending) return;
    const identifier = method === 'email' ? (emailInput?.value || '').trim().toLowerCase() : phoneIdentifier();
    if (method === 'email' && !/^\S+@\S+\.\S+$/.test(identifier)) {
      setStatus('Enter a valid email address.', 'error');
      return;
    }
    if (method === 'phone' && identifier.replace(/\D/g, '').length < 10) {
      setStatus('Enter a valid mobile number including the correct country code.', 'error');
      return;
    }

    sending = true;
    submit.disabled = true;
    submit.textContent = 'SENDING CODE…';
    try {
      const payload = method === 'email'
        ? { email: identifier, options: { shouldCreateUser: true, emailRedirectTo: window.location.origin } }
        : { phone: identifier, options: { shouldCreateUser: true } };
      const { error } = await client.auth.signInWithOtp(payload);
      if (error) throw error;
      pendingIdentifier = identifier;
      form.classList.add('hidden');
      tabs.classList.add('hidden');
      otpStage.classList.remove('hidden');
      document.getElementById('otpDestination').textContent = `Code sent to ${identifier}. Enter it below to continue.`;
      setStatus('Verification code sent. It may take a few seconds to arrive.', 'success');
      otpStage.querySelector('[data-otp-index="0"]')?.focus();
    } catch (err) {
      setStatus(err?.message || 'Unable to send the verification code. Check the authentication configuration.', 'error');
    } finally {
      sending = false;
      submit.disabled = false;
      submitLabel();
    }
  }

  document.addEventListener('submit', async e => {
    if (e.target === form) {
      if (configured) {
        e.preventDefault();
        e.stopImmediatePropagation();
        await requestOtp();
      } else if (method === 'phone') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setStatus('Mobile OTP needs Supabase plus an SMS provider. Email local-beta sign-in remains available until that is connected.', 'error');
      }
      return;
    }

    if (e.target.id === 'otpForm') {
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
        if (!user) throw new Error('Authentication succeeded but no user session was returned.');
        mirrorAuthenticatedUser(user);
        setStatus('Identity verified. Opening your workspace…', 'success');
        window.location.reload();
      } catch (err) {
        setStatus(err?.message || 'The code could not be verified. Try again.', 'error');
        verifyBtn.disabled = false;
        verifyBtn.innerHTML = 'VERIFY & SIGN IN <span>→</span>';
      }
    }
  }, true);

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
    otpStage.classList.add('hidden');
    tabs.classList.remove('hidden');
    form.classList.remove('hidden');
    pendingIdentifier = '';
    otpStage.querySelectorAll('[data-otp-index]').forEach(input => input.value = '');
    setStatus(configured ? 'Secure passwordless authentication is connected. We will send a one-time verification code.' : 'OTP authentication UI is ready. Connect Supabase to activate email and mobile verification.', configured ? 'ready' : '');
  }

  document.getElementById('otpBackBtn')?.addEventListener('click', resetOtp);
  document.getElementById('resendOtpBtn')?.addEventListener('click', async () => {
    if (!pendingIdentifier || !configured || sending) return;
    const id = pendingIdentifier;
    const payload = method === 'email'
      ? { email: id, options: { emailRedirectTo: window.location.origin } }
      : { phone: id };
    try {
      const { error } = await client.auth.signInWithOtp(payload);
      if (error) throw error;
      setStatus('A new verification code was sent.', 'success');
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

  document.getElementById('signOutBtn')?.addEventListener('click', () => {
    if (configured) client.auth.signOut().catch(() => {});
  }, true);

  async function enforceSecureSession() {
    if (!configured) return;
    try {
      const { data } = await client.auth.getSession();
      const session = data?.session;
      const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
      if (session?.user) {
        const key = String(session.user.email || session.user.phone || session.user.id).toLowerCase();
        if (!store.profiles?.[key] || store.activeProfile !== key) {
          mirrorAuthenticatedUser(session.user);
          window.location.reload();
          return;
        }
        const profile = store.profiles[key];
        const identityText = profile.email || profile.phone || '';
        const profileEmail = document.getElementById('profileEmail');
        if (profileEmail && identityText) profileEmail.textContent = identityText;
        return;
      }

      if (store.activeProfile) {
        store.activeProfile = null;
        localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
      }
      document.getElementById('authScreen')?.classList.remove('hidden');
      document.getElementById('appShell')?.classList.add('hidden');
    } catch (_) {
      setStatus('Authentication service is temporarily unavailable. Please try again.', 'error');
    }
  }

  setMethod('email');
  enforceSecureSession();
})();
