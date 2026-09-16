(() => {
  const cfg = window.MFT_AUTH_CONFIG || {};
  const VERSION = 'otp-only-v1';
  if (!cfg.supabaseUrl || !window.supabase?.createClient) return;

  try {
    if (localStorage.getItem('mftAuthFlowVersion') !== VERSION) {
      const projectRef = new URL(cfg.supabaseUrl).hostname.split('.')[0];
      if (projectRef) localStorage.removeItem(`sb-${projectRef}-auth-token`);

      const store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{"profiles":{},"activeProfile":null}');
      store.activeProfile = null;
      localStorage.setItem('marketForwardTestV2', JSON.stringify(store));
      localStorage.setItem('mftAuthFlowVersion', VERSION);
    }
  } catch (_) {}

  // Do not accept magic-link URL tokens. Market Forward Test uses OTP entry only.
  if (window.location.hash && /(?:access_token|refresh_token|type=signup|type=magiclink)/i.test(window.location.hash)) {
    history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }

  const originalCreateClient = window.supabase.createClient.bind(window.supabase);
  window.supabase.createClient = (url, key, options = {}) => {
    const client = originalCreateClient(url, key, {
      ...options,
      auth: {
        ...(options.auth || {}),
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });
    window.__MFT_SUPABASE_CLIENT = client;
    return client;
  };
})();
