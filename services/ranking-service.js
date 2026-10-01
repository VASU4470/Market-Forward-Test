(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.ranking = {
    getRanking: async () => (await root.api.request('/api/v1/ranking')).ranking || []
  };
})();
