(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.indices = {
    async getIndices() {
      const payload = await root.api.request('/api/v1/indices', { public: true });
      return payload.indices || [];
    }
  };
})();
