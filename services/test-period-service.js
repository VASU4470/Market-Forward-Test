(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.testPeriods = {
    create: async (period,userId) => (await root.api.request('/api/v1/test-periods', { method: 'POST', body: period, expectedUserId:userId })).test_period,
    list: async userId => (await root.api.request('/api/v1/test-periods', {expectedUserId:userId})).test_periods || [],
    update: async (id, changes,userId) => (await root.api.request(`/api/v1/test-periods/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes, expectedUserId:userId })).test_period
  };
})();
