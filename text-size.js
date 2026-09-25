(() => {
  const KEY = 'pizeroTextSize';
  const DEFAULT = 110;
  const MIN = 100;
  const MAX = 150;
  const STEP = 10;
  const root = document.documentElement;
  const normalize = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= MIN && number <= MAX
      ? Math.round(number / STEP) * STEP : DEFAULT;
  };
  let size = DEFAULT;
  try { size = normalize(localStorage.getItem(KEY)); } catch (_) {}

  function apply(announce = false) {
    root.style.fontSize = `${size}%`;
    root.dataset.textSize = String(size);
    document.querySelectorAll('[data-text-size-value]').forEach(el => { el.textContent = `${size}%`; });
    document.querySelectorAll('[data-text-size="decrease"]').forEach(el => { el.disabled = size === MIN; });
    document.querySelectorAll('[data-text-size="increase"]').forEach(el => { el.disabled = size === MAX; });
    const status = document.getElementById('textSizeAnnouncement');
    if (announce && status) status.textContent = `Text size ${size} percent`;
  }
  // Apply before the first paint, including when the user returns to sign in.
  apply();
  document.addEventListener('DOMContentLoaded', () => apply());
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-text-size]');
    if (!button || button.disabled || button === root) return;
    const action = button.dataset.textSize;
    if (!['reset', 'increase', 'decrease'].includes(action)) return;
    size = action === 'reset' ? DEFAULT : Math.min(MAX, Math.max(MIN, size + (action === 'increase' ? STEP : -STEP)));
    try { localStorage.setItem(KEY, String(size)); } catch (_) {}
    apply(true);
  });
  window.addEventListener('storage', event => {
    if (event.key === KEY || event.key === null) {
      size = normalize(event.newValue);
      apply();
    }
  });
})();
