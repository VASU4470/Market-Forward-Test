(() => {
  const resultSection = document.getElementById('result');
  const scorePanel = document.getElementById('scorePanel');
  const actualForm = document.getElementById('actualForm');
  if (!resultSection || !scorePanel || !actualForm) return;

  const autoCard = document.createElement('section');
  autoCard.className = 'panel auto-score-panel';
  autoCard.innerHTML = `
    <div class="auto-score-head">
      <div>
        <span class="section-kicker">AUTOMATIC RESULT</span>
        <h2>Market outcome</h2>
      </div>
      <span class="auto-source-badge">NIFTY 50</span>
    </div>
    <div id="autoScoreState" class="auto-score-state waiting">
      <span class="auto-state-icon">↻</span>
      <div><b>Ready to fetch the market result</b><small>The app can classify the completed NSE session and score your locked view automatically.</small></div>
    </div>
    <div id="autoMarketGrid" class="auto-market-grid hidden"></div>
    <div class="auto-score-actions">
      <button id="fetchMarketResult" class="primary-btn compact-btn" type="button">CHECK MARKET RESULT <span>→</span></button>
      <button id="manualResultToggle" class="secondary-btn" type="button">Manual fallback</button>
    </div>
    <p id="autoMethodNote" class="auto-method-note">Automatic scoring uses fixed rules, not AI judgment.</p>
  `;

  resultSection.insertBefore(autoCard, scorePanel);
  actualForm.classList.add('manual-result-form');
  actualForm.hidden = true;

  const stateBox = document.getElementById('autoScoreState');
  const marketGrid = document.getElementById('autoMarketGrid');
  const fetchBtn = document.getElementById('fetchMarketResult');
  const manualBtn = document.getElementById('manualResultToggle');
  const methodNote = document.getElementById('autoMethodNote');

  let lastMarketPayload = null;

  function setState(kind, title, message) {
    stateBox.className = `auto-score-state ${kind}`;
    const icons = { waiting: '↻', loading: '···', success: '✓', pending: '◷', error: '!' };
    stateBox.innerHTML = `<span class="auto-state-icon">${icons[kind] || '•'}</span><div><b>${title}</b><small>${message}</small></div>`;
  }

  function number(v) {
    return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  function renderMarket(payload) {
    lastMarketPayload = payload;
    const m = payload.market;
    marketGrid.classList.remove('hidden');
    marketGrid.innerHTML = [
      ['Prev close', number(m.prevClose)],
      ['Open', number(m.open)],
      ['High', number(m.high)],
      ['Low', number(m.low)],
      ['Close', number(m.close)],
      ['Session', payload.actual.dayType],
    ].map(([label, value]) => `<div><small>${label}</small><b>${value}</b></div>`).join('');
    methodNote.textContent = `${payload.actual.opening} · ${payload.actual.bias} · ${payload.actual.dayType} · ${payload.provider}`;
  }

  function showExistingAutomaticScore() {
    const p = current();
    if (!p?.score || p.actualSource?.mode !== 'automatic') return false;
    setState('success', `Automatically scored ${p.score.total}/100`, `Market result was fetched from ${p.actualSource.provider || 'the configured data provider'}.`);
    fetchBtn.textContent = 'REFRESH MARKET RESULT';
    actualForm.hidden = true;
    return true;
  }

  async function fetchMarketResult() {
    const p = current();
    if (!p) {
      setState('pending', 'Lock a prediction first', 'Automatic scoring becomes available after you lock a market view.');
      return;
    }

    setState('loading', 'Fetching Nifty session data…', 'Reading the completed market session and applying the scoring rules.');
    fetchBtn.disabled = true;

    try {
      const response = await fetch(`/api/market-result?date=${encodeURIComponent(p.date)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 425) {
          setState('pending', 'Market result not ready yet', data.message || 'Try again after the NSE session is complete.');
          return;
        }
        if (data.error === 'NO_TRADING_SESSION') {
          setState('pending', 'No trading session found', data.message || 'This may be an NSE market holiday.');
          return;
        }
        if (data.error === 'TOKEN_MISSING') {
          setState('error', 'Automatic data is not configured yet', 'The scoring workflow is ready, but this local server still needs a read-only market-data token. Manual scoring remains available below.');
          actualForm.hidden = false;
          return;
        }
        throw new Error(data.message || `Market-data request failed (${response.status}).`);
      }

      p.actual = data.actual;
      p.score = calculateScore(p, data.actual);
      p.actualSource = {
        mode: 'automatic',
        provider: data.provider,
        fetchedAt: data.generatedAt,
        methodology: data.methodology,
      };
      saveRoot();
      renderAll();
      renderMarket(data);
      setState('success', `Automatically scored ${p.score.total}/100`, `${data.actual.opening} · ${data.actual.bias} · ${data.actual.dayType}`);
      actualForm.hidden = true;
      fetchBtn.textContent = 'REFRESH MARKET RESULT';
    } catch (error) {
      setState('error', 'Could not fetch market data', error.message || 'Use the manual fallback or try again.');
      actualForm.hidden = false;
    } finally {
      fetchBtn.disabled = false;
    }
  }

  fetchBtn.addEventListener('click', fetchMarketResult);
  manualBtn.addEventListener('click', () => {
    actualForm.hidden = !actualForm.hidden;
    manualBtn.textContent = actualForm.hidden ? 'Manual fallback' : 'Hide manual entry';
  });

  document.querySelectorAll('[data-target="result"]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.setTimeout(() => {
        if (!showExistingAutomaticScore()) fetchMarketResult();
      }, 120);
    });
  });

  const observer = new MutationObserver(() => {
    if (resultSection.classList.contains('active')) showExistingAutomaticScore();
  });
  observer.observe(resultSection, { attributes: true, attributeFilter: ['class'] });

  showExistingAutomaticScore();
})();
