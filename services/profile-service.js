(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.profile = {
    getProfile: async () => (await root.api.request('/api/v1/profile')).profile,
    updateProfile: async profile => (await root.api.request('/api/v1/profile', { method: 'PATCH', body: profile })).profile
  };
})();
