(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.statistics = {
    getMyStatistics: async () => (await root.api.request('/api/v1/statistics')).statistics,
    getMyScoreHistory: async () => (await root.api.request('/api/v1/score-history')).history || [],
    getMyTestProgress: async () => await root.api.request('/api/v1/test-progress')
  };
})();
