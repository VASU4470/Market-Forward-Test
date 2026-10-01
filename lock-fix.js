(function () {
  const confirmButton = document.getElementById('confirmLock');
  if (!confirmButton) return;

  confirmButton.onclick = () => {
    if (!pendingPrediction) return;

    const state = activeState();
    const prediction = {
      date: dateKey,
      indexId: selectedIndexId,
      ...pendingPrediction,
      lockedAt: new Date().toISOString(),
      actual: null,
      score: null,
      cloudSync: 'pending'
    };

    state.predictions.push(prediction);

    // Complete the user-facing lock immediately. Cloud sync must never block the UI.
    pendingPrediction = null;
    saveRoot();
    const dialog = document.getElementById('lockDialog');
    if (dialog?.open) dialog.close();
    renderAll();

    if (!window.PiZeroServices?.predictions || !window.__MFT_SUPABASE_CLIENT) return;

    window.PiZeroServices.predictions.createPrediction({
      index_id: selectedIndexId,
      trading_date: prediction.date,
      bias: prediction.bias,
      opening_view: prediction.opening,
      day_type: prediction.dayType,
      support: Number(prediction.support),
      resistance: Number(prediction.resistance)
    }).then(() => {
      prediction.cloudSync = 'synced';
      saveRoot();
    }).catch(() => {
      prediction.cloudSync = 'pending';
      saveRoot();
    });
  };
})();
