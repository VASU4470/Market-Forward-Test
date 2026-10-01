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

  function historyKey(prediction) {
    return `${prediction.date || ''}::${predictionIndexId(prediction)}`;
  }

  const historyStyle = document.createElement('style');
  historyStyle.textContent = `
    .history-item[data-history-key]{cursor:pointer;transition:transform .16s ease,border-color .16s ease,box-shadow .16s ease}
    .history-item[data-history-key]:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--primary) 35%,var(--border));box-shadow:0 10px 26px rgba(28,20,40,.08)}
    .history-item[data-history-key]:focus-visible{outline:3px solid color-mix(in srgb,var(--primary) 28%,transparent);outline-offset:2px}
    .history-status{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:6px 9px;font-size:.72rem;font-weight:800;white-space:nowrap}
    .history-status.pending{background:var(--amber-soft);color:var(--amber)}
    .history-status.scored{background:var(--primary-soft);color:var(--primary-strong)}
    .history-entry-dialog{border:0;padding:0;background:transparent;max-width:min(720px,calc(100vw - 24px));width:100%}
    .history-entry-dialog::backdrop{background:rgba(20,15,25,.48);backdrop-filter:blur(4px)}
    .history-entry-card{background:var(--surface);color:var(--text);border:1px solid var(--border);border-radius:22px;padding:22px;box-shadow:0 28px 80px rgba(23,16,31,.22)}
    .history-entry-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:16px}
    .history-entry-head h2{margin:6px 0 3px;font-size:1.35rem}.history-entry-head p{margin:0;color:var(--muted)}
    .history-entry-close{border:1px solid var(--border);background:var(--field);color:var(--text);width:36px;height:36px;border-radius:50%;font-size:1.15rem;cursor:pointer}
    .history-detail-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin:14px 0}
    .history-detail-grid>div{background:var(--field);border:1px solid var(--border-soft);border-radius:12px;padding:11px}
    .history-detail-grid small,.history-detail-grid b{display:block}.history-detail-grid small{font-size:.72rem;color:var(--muted);margin-bottom:4px}.history-detail-grid b{font-size:.86rem}
    .history-score-detail{border-top:1px solid var(--border-soft);padding-top:15px;margin-top:15px}
    .history-score-hero{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px}.history-score-hero strong{font-size:2rem;color:var(--primary-strong)}
    .history-entry-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:18px;flex-wrap:wrap}
    @media(max-width:620px){.history-detail-grid{grid-template-columns:repeat(2,1fr)}.history-entry-card{padding:17px}.history-entry-actions>*{width:100%}}
  `;
  document.head.appendChild(historyStyle);

  const historyDialog = document.createElement('dialog');
  historyDialog.className = 'history-entry-dialog';
  historyDialog.id = 'historyEntryDialog';
  document.body.appendChild(historyDialog);

  function formatLockedAt(value) {
    if (!value) return 'Not available';
    try {
      return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: INDIA_TZ
      }).format(new Date(value)) + ' IST';
    } catch (_) {
      return 'Not available';
    }
  }

  function openHistoryEntry(prediction) {
    if (!prediction) return;
    const market = indexForPrediction(prediction);
    const dateObj = new Date(`${prediction.date}T12:00:00+05:30`);
    const date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: INDIA_TZ }).format(dateObj);
    const actual = prediction.actual;
    const score = prediction.score;
    const detail = score?.detail || {};
    const scoreLabel = score ? (score.source === 'server' || score.rule_version ? 'Server scored' : 'Scored') : 'Score pending';
    const canScoreNow = !score;

    historyDialog.innerHTML = `
      <div class="history-entry-card">
        <div class="history-entry-head">
          <div><span class="section-kicker">LOCKED MARKET VIEW</span><h2>${escapeHtml(market.display_name)} · ${date}</h2><p>Locked ${escapeHtml(formatLockedAt(prediction.lockedAt))}</p></div>
          <button class="history-entry-close" type="button" aria-label="Close history details">×</button>
        </div>
        <div class="history-detail-grid">
          <div><small>Bias</small><b>${escapeHtml(prediction.bias || '—')}</b></div>
          <div><small>Opening</small><b>${escapeHtml(prediction.opening || '—')}</b></div>
          <div><small>Day type</small><b>${escapeHtml(prediction.dayType || '—')}</b></div>
          <div><small>Support</small><b>${escapeHtml(prediction.support ?? '—')}</b></div>
          <div><small>Resistance</small><b>${escapeHtml(prediction.resistance ?? '—')}</b></div>
          <div><small>Status</small><b>${scoreLabel}</b></div>
        </div>
        ${actual ? `<div class="history-score-detail"><span class="section-kicker">ACTUAL OUTCOME</span><div class="history-detail-grid">
          <div><small>Direction</small><b>${escapeHtml(actual.bias || '—')}</b></div>
          <div><small>Opening</small><b>${escapeHtml(actual.opening || '—')}</b></div>
          <div><small>Day type</small><b>${escapeHtml(actual.dayType || '—')}</b></div>
          <div><small>Low</small><b>${escapeHtml(actual.low ?? '—')}</b></div>
          <div><small>High</small><b>${escapeHtml(actual.high ?? '—')}</b></div>
          <div><small>Source</small><b>${escapeHtml(prediction.actualSource?.mode === 'automatic' ? 'Automatic' : 'Manual')}</b></div>
        </div></div>` : ''}
        ${score ? `<div class="history-score-detail"><div class="history-score-hero"><div><span class="section-kicker">SCORE</span><p class="muted">Breakdown of this locked forecast.</p></div><strong>${score.total}/100</strong></div><div class="history-detail-grid">
          <div><small>Bias</small><b>${Math.round(detail.bias || 0)}/25</b></div>
          <div><small>Opening</small><b>${Math.round(detail.opening || 0)}/20</b></div>
          <div><small>Day type</small><b>${Math.round(detail.dayType || 0)}/20</b></div>
          <div><small>Support</small><b>${Math.round(detail.support || 0)}/17.5</b></div>
          <div><small>Resistance</small><b>${Math.round(detail.resistance || 0)}/17.5</b></div>
        </div></div>` : `<div class="history-score-detail"><div class="history-score-hero"><div><span class="section-kicker">SCORE PENDING</span><p class="muted">This forecast has not been scored yet.</p></div><span class="history-status pending">◷ Score pending</span></div></div>`}
        <div class="history-entry-actions">
          ${canScoreNow ? '<button class="primary-btn" type="button" data-score-history-entry>REVIEW / SCORE THIS ENTRY <span>→</span></button>' : ''}
          <button class="secondary-btn" type="button" data-close-history-entry>CLOSE</button>
        </div>
      </div>`;

    historyDialog.querySelector('.history-entry-close')?.addEventListener('click', () => historyDialog.close());
    historyDialog.querySelector('[data-close-history-entry]')?.addEventListener('click', () => historyDialog.close());
    historyDialog.querySelector('[data-score-history-entry]')?.addEventListener('click', () => {
      resultSelection = {date: prediction.date, indexId: market.id};
      selectedIndexId = market.id;
      const mainSelector = document.getElementById('indexSelect');
      if (mainSelector) mainSelector.value = selectedIndexId;
      historyDialog.close();
      renderAll();
      navigate('result');
      window.setTimeout(showSelectedResultState, 60);
    });

    if (!historyDialog.open) historyDialog.showModal();
  }

  historyDialog.addEventListener('click', event => {
    if (event.target === historyDialog) historyDialog.close();
  });

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
      const encodedKey = encodeURIComponent(historyKey(p));
      return `<div class="history-item" data-history-key="${encodedKey}" role="button" tabindex="0" aria-label="Open ${escapeHtml(market.display_name)} prediction details for ${date}">
        <div><div class="date">${date} · ${escapeHtml(market.display_name)}</div><div class="meta">${escapeHtml(p.bias)} · ${escapeHtml(p.opening)} · ${escapeHtml(p.dayType)}</div></div>
        <div>${p.score ? `<span class="history-status scored">${p.score.total}/100</span>` : '<span class="history-status pending">◷ Score pending</span>'}</div>
      </div>`;
    }).join('');
  };

  const historyList = document.getElementById('historyList');
  function activateHistoryRow(target) {
    const row = target.closest?.('[data-history-key]');
    if (!row) return;
    const key = decodeURIComponent(row.dataset.historyKey || '');
    const prediction = uniqueHistoryItems().find(item => historyKey(item) === key);
    openHistoryEntry(prediction);
  }
  historyList?.addEventListener('click', event => activateHistoryRow(event.target));
  historyList?.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest?.('[data-history-key]');
    if (!row) return;
    event.preventDefault();
    activateHistoryRow(row);
  });

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
      <button id="manualResultToggle" class="secondary-btn" type="button">Enter actual result</button>
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
    const targetDate = resultSelection?.date || dateKey;
    const predictionIds = new Set((activeState()?.predictions || [])
      .filter(p => p.date === targetDate)
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
    const p = selectedResultPrediction();

    if (!p) {
      setState('pending', `No ${market.display_name} prediction locked`, 'Choose a market with a locked prediction, or return to Forward Test and record one first.');
      actualForm.hidden = true;
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'CHECK MARKET RESULT →';
      return false;
    }

    fetchBtn.disabled = false;
    if (p.score) {
      const isServerScore = p.score.source === 'server' || p.score.rule_version;
      const mode = isServerScore ? 'Server' : (p.actualSource?.mode === 'automatic' ? 'Automatically' : 'Manually');
      const note = isServerScore ? '' : ' · local fallback; not included in server statistics';
      setState('success', `${mode} scored ${p.score.total}/100`, `${market.display_name} · ${p.bias} · ${p.opening} · ${p.dayType}${note}`);
      fetchBtn.textContent = isAutomaticMarketSupported() ? 'REFRESH MARKET RESULT' : 'AUTOMATIC RESULT UNAVAILABLE';
      actualForm.hidden = true;
      return true;
    }

    if (!isAutomaticMarketSupported()) {
      setState('pending', `${market.display_name} is ready for manual scoring`, 'Automatic market-data scoring is currently enabled for NIFTY 50 only. Enter the completed session data below for this market.');
      fetchBtn.disabled = true;
      fetchBtn.textContent = 'AUTOMATIC RESULT UNAVAILABLE';
      actualForm.hidden = false;
      manualBtn.textContent = 'Hide actual result entry';
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
    const p = selectedResultPrediction();
    if (!p) {
      setState('pending', 'Lock a prediction first', `No ${market.display_name} prediction is available for today.`);
      return;
    }
    if (!isAutomaticMarketSupported()) {
      setState('pending', `${market.display_name} uses manual scoring for now`, 'Enter the actual market outcome below. Automatic provider support for this index can be added separately.');
      actualForm.hidden = false;
      manualBtn.textContent = 'Hide actual result entry';
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
          manualBtn.textContent = 'Hide actual result entry';
          return;
        }
        throw new Error(data.message || `Market-data request failed (${response.status}).`);
      }

      p.actual = data.actual;
      if (p.cloudId && window.PiZeroServices?.predictions?.scorePrediction) {
        const scored = await window.PiZeroServices.predictions.scorePrediction(p.cloudId);
        if (scored?.scoring_status === 'scored') {
          const detail = scored.score_details || {};
          p.score = { source:'server', total:Number(scored.score), detail:{ bias:detail.bias || 0, opening:detail.opening || 0, dayType:detail.day_type ?? detail.dayType ?? 0, support:detail.support || 0, resistance:detail.resistance || 0 }, rule_version:scored.scoring_rule_version };
        } else {
          p.score = null;
          setState('pending', 'Market session is not ready for server scoring', 'The server will score this locked prediction once the persisted market session is available.');
          return;
        }
      } else {
        // Local scoring remains only for records that have not migrated to cloud storage.
        p.score = calculateScore(p, data.actual);
        p.score.source = 'local';
      }
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
      setState('error', 'Could not fetch market data', error.message || 'Use Enter actual result or try again.');
      actualForm.hidden = false;
      manualBtn.textContent = 'Hide actual result entry';
    } finally {
      fetchBtn.disabled = false;
    }
  }

  resultIndexSelect.addEventListener('change', () => {
    selectedIndexId = resultIndexSelect.value;
    resultSelection = {date: resultSelection?.date || dateKey, indexId: selectedIndexId};
    const mainSelector = document.getElementById('indexSelect');
    if (mainSelector) mainSelector.value = selectedIndexId;
    renderAll();
    showSelectedResultState();
  });

  fetchBtn.addEventListener('click', fetchMarketResult);
  manualBtn.addEventListener('click', () => {
    const p = selectedResultPrediction();
    if (!p) {
      showSelectedResultState();
      return;
    }
    actualForm.hidden = !actualForm.hidden;
    manualBtn.textContent = actualForm.hidden ? 'Enter actual result' : 'Hide actual result entry';
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
        if (!showSelectedResultState() && isAutomaticMarketSupported() && selectedResultPrediction()) fetchMarketResult();
      }, 120);
    });
  });

  const observer = new MutationObserver(() => {
    if (resultSection.classList.contains('active')) showSelectedResultState();
  });
  observer.observe(resultSection, { attributes: true, attributeFilter: ['class'] });

  showSelectedResultState();
})();
