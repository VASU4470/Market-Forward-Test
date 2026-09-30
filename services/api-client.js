(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};

  async function accessToken() {
    const client = window.__MFT_SUPABASE_CLIENT;
    if (!client) return null;
    const { data } = await client.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function request(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (!options.public) {
      const token = await accessToken();
      if (!token) throw new Error('Please sign in again to continue.');
      headers.Authorization = `Bearer ${token}`;
    }
    const response = await fetch(path, {
      ...options,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      cache: 'no-store'
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.message || payload.error || `Request failed (${response.status}).`);
      error.status = response.status;
      error.code = payload.error;
      throw error;
    }
    return payload;
  }

  root.api = { request, accessToken };
})();
