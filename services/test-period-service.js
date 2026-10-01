(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.testPeriods = {
    create: async period => (await root.api.request('/api/v1/test-periods', { method: 'POST', body: period })).test_period,
    list: async () => (await root.api.request('/api/v1/test-periods')).test_periods || [],
    update: async (id, changes) => (await root.api.request(`/api/v1/test-periods/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes })).test_period
  };
})();
