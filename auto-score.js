(() => {
  const resultSection = document.getElementById('result');
  const scorePanel = document.getElementById('scorePanel');
  const actualForm = document.getElementById('actualForm');
  if (!resultSection || !scorePanel || !actualForm) return;

  function predictionIndexId(prediction) {
    return prediction?.indexId || 'local-nifty50';
  }

  function predictionQuality(prediction) {
    let score = 0;
    if (prediction?.score) score += 100;
    if (prediction?.actual) score += 20;
    if (prediction?.cloudSync === 'synced') score += 10;
    const stamp = Date.parse(prediction?.lockedAt || '') || 0;
    return score * 1e15 + stamp;
  }

  function dedupeLocalPredictions() {
    const state = activeState?.();
    if (!state?.predictions?.length) return false;

    const unique = new Map();
    for (const prediction of state.predictions) {
      const key = `${prediction.date || ''}::${predictionIndexId(prediction)}`;
      const existing = unique.get(key);
      if (!existing || predictionQuality(prediction) > predictionQuality(existing)) {
        unique.set(key, prediction);
      }
    }

    if (unique.size === state.predictions.length) return false;
    state.predictions = [...unique.values()];
    saveRoot();
    return true;
  }

  function indexForPrediction(prediction) {
    const id = predictionIndexId(prediction);
    return indices.find(item => item.id === id)
      || (id === 'local-nifty50' ? indices.find(item => item.code === 'NIFTY50') : null)
      || { id, code: id === 'local-nifty50' ? 'NIFTY50' : '', display_name: id === 'local-nifty50' ? 'NIFTY 50' : 'Market' };
  }

  function uniqueHistoryItems() {
    dedupeLocalPredictions();
    return [...(activeState()?.predictions || [])].sort((a, b) => {
      const byDate = String(b.date || '').localeCompare(String(a.date || ''));
      if (byDate) return byDate;
      return String(indexForPrediction(a).display_name).localeCompare(String(indexForPrediction(b).display_name));
    });
  }

  // Replace the old history filtering/rendering so one date+index prediction appears once.
  filteredHistory = function () {
    const items = uniqueHistoryItems();
    if (historyFilter === 'scored') return items.filter(p => p.score);
    if (historyFilter === '7') return items.slice(0, 7);
    if (historyFilter === '30') return items.slice(0, 30);
    return items;
  };

  renderHistory = function () {
    const list = document.getElementById('historyList');
    if (!list) return;
    const items = filteredHistory();
    const scored = items.filter(p => p.score);
    const avg = scored.length ? Math.round(scored.reduce((sum, p) => sum + p.score.total, 0) / scored.length) : null;
    document.getElementById('historySummary').innerHTML = `<span>${items.length} entr${items.length === 1 ? 'y' : 'ies'}</span><span>${avg === null ? 'No scored average' : `Average ${avg}/100`}</span>`;
    if (!items.length) {
      list.innerHTML = '<div class="empty">No history matches this filter.</div>';
      return;
    }

    list.innerHTML = items.map(p => {
      const dateObj = new Date(`${p.date}T12:00:00+05:30`);
      const date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: INDIA_TZ }).format(dateObj);
      const market = indexForPrediction(p);
      return `<div class="history-item">
        <div><div class="date">${date} · ${escapeHtml(market.display_name)}</div><div class="meta">${escapeHtml(p.bias)} · ${escapeHtml(p.opening)} · ${escapeHtml(p.dayType)}</div></div>
        <div class="history-score">${p.score ? p.score.total : '—'}</div>
      </div>`;
    }).join('');
  };

  dedupeLocalPredictions();
  renderHistory();

  const autoCard = document.createElement('section');
  autoCard.className = 'panel auto-score-panel';
  autoCard.innerHTML = `
    <div class="auto-score-head">
      <div>
        <span class="section-kicker">AUTOMATIC RESULT</span>
        <h2>Market outcome</h2>
      </div>
      <label class="select-label result-market-select"><span>Market</span><select id="resultIndexSelect" aria-label="Select prediction market"></select></label>
    </div>
    <div id="autoScoreState" class="auto-score-state waiting">
      <span class="auto-state-icon">↻</span>
      <div><b>Ready to fetch the market result</b><small>Select a locked market view to review or score it.</small></div>
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
  const resultIndexSelect = document.getElementById('resultIndexSelect');

  const actualHead = actualForm.querySelector('.panel-head');
  let manualMarketNote = null;
  if (actualHead) {
    manualMarketNote = document.createElement('span');
    manualMarketNote.className = 'panel-note';
    actualHead.appendChild(manualMarketNote);
  }

  function selectedMarket() {
    return selectedIndex();
  }

  function todaysPredictionMarkets() {
    dedupeLocalPredictions();
    const predictionIds = new Set((activeState()?.predictions || [])
      .filter(p => p.date === dateKey)
      .map(predictionIndexId));
    const available = indices.filter(item => predictionIds.has(item.id) || (predictionIds.has('local-nifty50') && item.code === 'NIFTY50'));
    return available.length ? available : indices;
  }

  function syncResultIndexSelector() {
    const markets = todaysPredictionMarkets();
    if (!markets.length) return;
    if (!markets.some(item => item.id === selectedIndexId)) selectedIndexId = markets[0].id;
    resultIndexSelect.innerHTML = markets.map(item => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.display_name)}</option>`).join('');
    resultIndexSelect.value = selectedIndexId;
    if (manualMarketNote) manualMarketNote.textContent = selectedMarket().display_name;
  }

  function setState(kind, title, message) {
    stateBox.className = `auto-score-state ${kind}`;
    const icons = { waiting: '↻', loading: '···', success: '✓', pending: '◷', error: '!' };
    stateBox.innerHTML = `<span class="auto-state-icon">${icons[kind] || '•'}</span><div><b>${title}</b><small>${message}</small></div>`;
  }

  function number(v) {
    return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  }

  function clearMarketGrid() {
    marketGrid.classList.add('hidden');
    marketGrid.innerHTML = '';
  }

  function renderMarket(payload) {
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

  function isAutomaticMarketSupported() {
    return selectedMarket()?.code === 'NIFTY50';
  }

  function showSelectedResultState() {
    syncResultIndexSelector();
    clearMarketGrid();
    const market = selectedMarket();
    const p = current();

    if (!p) {
      setState('pending', `No ${market.display_name} prediction locked`, 'Choose a market with a locked prediction, or return to Forward Test and record one first.');
      actualForm.hidden = true;
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'CHECK MARKET RESULT →';
      return false;
    }

    fetchBtn.disabled = false;
    if (p.score) {
      const mode = p.actualSource?.mode === 'automatic' ? 'Automatically' : 'Manually';
      setState('success', `${mode} scored ${p.score.total}/100`, `${market.display_name} · ${p.bias} · ${p.opening} · ${p.dayType}`);
      fetchBtn.textContent = isAutomaticMarketSupported() ? 'REFRESH MARKET RESULT' : 'AUTOMATIC RESULT UNAVAILABLE';
      actualForm.hidden = true;
      return true;
    }

    if (!isAutomaticMarketSupported()) {
      setState('pending', `${market.display_name} is ready for manual scoring`, 'Automatic market-data scoring is currently enabled for NIFTY 50 only. Enter the completed session data below for this market.');
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'AUTOMATIC RESULT UNAVAILABLE';
      actualForm.hidden = false;
      manualBtn.textContent = 'Hide manual entry';
      methodNote.textContent = `Manual scoring selected for ${market.display_name}.`;
      return false;
    }

    setState('waiting', `Ready to score ${market.display_name}`, 'Automatic scoring becomes available after the completed market session.');
    fetchBtn.textContent = 'CHECK MARKET RESULT →';
    return false;
  }

  async function fetchMarketResult() {
    syncResultIndexSelector();
    const market = selectedMarket();
    const p = current();
    if (!p) {
      setState('pending', 'Lock a prediction first', `No ${market.display_name} prediction is available for today.`);
      return;
    }
    if (!isAutomaticMarketSupported()) {
      setState('pending', `${market.display_name} uses manual scoring for now`, 'Enter the actual market outcome below. Automatic provider support for this index can be added separately.');
      actualForm.hidden = false;
      manualBtn.textContent = 'Hide manual entry';
      return;
    }

    setState('loading', `Fetching ${market.display_name} session data…`, 'Reading the completed market session and applying the scoring rules.');
    fetchBtn.disabled = true;

    try {
      const response = await fetch(`/api/market-result?date=${encodeURIComponent(p.date)}`, { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 425) {
          setState('pending', 'Market result not ready yet', data.message || 'Try again after the session is complete.');
          return;
        }
        if (data.error === 'NO_TRADING_SESSION') {
          setState('pending', 'No trading session found', data.message || 'This may be a market holiday.');
          return;
        }
        if (data.error === 'TOKEN_MISSING') {
          setState('error', 'Automatic data is not configured yet', 'The scoring workflow is ready, but the server still needs a read-only market-data token. Manual scoring remains available below.');
          actualForm.hidden = false;
          manualBtn.textContent = 'Hide manual entry';
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
      setState('success', `Automatically scored ${p.score.total}/100`, `${market.display_name} · ${data.actual.opening} · ${data.actual.bias} · ${data.actual.dayType}`);
      actualForm.hidden = true;
      fetchBtn.textContent = 'REFRESH MARKET RESULT';
      renderHistory();
    } catch (error) {
      setState('error', 'Could not fetch market data', error.message || 'Use the manual fallback or try again.');
      actualForm.hidden = false;
      manualBtn.textContent = 'Hide manual entry';
    } finally {
      fetchBtn.disabled = false;
    }
  }

  resultIndexSelect.addEventListener('change', () => {
    selectedIndexId = resultIndexSelect.value;
    const mainSelector = document.getElementById('indexSelect');
    if (mainSelector) mainSelector.value = selectedIndexId;
    renderAll();
    showSelectedResultState();
  });

  fetchBtn.addEventListener('click', fetchMarketResult);
  manualBtn.addEventListener('click', () => {
    const p = current();
    if (!p) {
      showSelectedResultState();
      return;
    }
    actualForm.hidden = !actualForm.hidden;
    manualBtn.textContent = actualForm.hidden ? 'Manual fallback' : 'Hide manual entry';
  });

  // After manual scoring, refresh the history and selected-market status.
  actualForm.addEventListener('submit', () => {
    window.setTimeout(() => {
      renderHistory();
      showSelectedResultState();
    }, 0);
  });

  document.querySelectorAll('[data-target="result"]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.setTimeout(() => {
        syncResultIndexSelector();
        if (!showSelectedResultState() && isAutomaticMarketSupported() && current()) fetchMarketResult();
      }, 120);
    });
  });

  const observer = new MutationObserver(() => {
    if (resultSection.classList.contains('active')) showSelectedResultState();
  });
  observer.observe(resultSection, { attributes: true, attributeFilter: ['class'] });

  showSelectedResultState();
})();
