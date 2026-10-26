// The compatibility entry point uses the same durable lock and test association.
(function () {
  const button=document.getElementById('confirmLock');
  if (button) button.onclick=lockPendingPrediction;
})();
