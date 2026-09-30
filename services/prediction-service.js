(function () {
  const root = window.PiZeroServices = window.PiZeroServices || {};
  root.predictions = {
    createPrediction: async prediction => (await root.api.request('/api/v1/predictions', { method: 'POST', body: prediction })).prediction,
    getMyPredictions: async (indexId = '') => {
      const suffix = indexId ? `?index_id=${encodeURIComponent(indexId)}` : '';
      return (await root.api.request(`/api/v1/predictions/me${suffix}`)).predictions || [];
    },
    async migrateLocalPredictions(userId, indexId) {
      const key = `mftCloudMigrationV1:${userId}`;
      if (localStorage.getItem(key) === 'complete') return { migrated: 0, skipped: true };
      let store;
      try { store = JSON.parse(localStorage.getItem('marketForwardTestV2') || '{}'); } catch (_) { store = {}; }
      const profile = store.activeProfile && store.profiles?.[store.activeProfile];
      const predictions = profile?.state?.predictions || [];
      let migrated = 0;
      for (const prediction of predictions) {
        try {
          await this.createPrediction({
            index_id: prediction.indexId || indexId,
            trading_date: prediction.date,
            bias: prediction.bias,
            opening_view: prediction.opening,
            day_type: prediction.dayType,
            support: Number(prediction.support),
            resistance: Number(prediction.resistance)
          });
          migrated += 1;
        } catch (error) {
          // A duplicate locked prediction is safe to treat as already migrated.
          if (![400, 409].includes(error.status)) throw error;
        }
      }
      localStorage.setItem(key, 'complete');
      return { migrated, skipped: false };
    }
  };
})();
