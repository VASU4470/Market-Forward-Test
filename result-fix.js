(() => {
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
    else fn();
  }

  ready(() => {
    const actualForm = document.getElementById('actualForm');
    if (!actualForm) return;

    const actualBias = document.getElementById('actualBias');
    const actualOpening = document.getElementById('actualOpening');
    const actualDayType = document.getElementById('actualDayType');
    const actualLow = document.getElementById('actualLow');
    const actualHigh = document.getElementById('actualHigh');

    function selectedMarket() {
      try { return typeof selectedIndex === 'function' ? selectedIndex() : null; }
      catch (_) { return null; }
    }

    function selectedPrediction() {
      try { return typeof current === 'function' ? current() : null; }
      catch (_) { return null; }
    }

    function ensurePlaceholder(select, label) {
      if (!select || select.querySelector('option[value=""]')) return;
      const option = document.createElement('option');
      option.value = '';
      option.textContent = `Select ${label}`;
      select.prepend(option);
    }

    ensurePlaceholder(actualBias, 'direction');
    ensurePlaceholder(actualOpening, 'opening');
    ensurePlaceholder(actualDayType, 'day type');

    let helper = document.getElementById('manualMarketHelper');
    if (!helper) {
      helper = document.createElement('p');
      helper.id = 'manualMarketHelper';
      helper.className = 'auto-method-note';
      const lowHighGrid = actualLow?.closest('.input-grid');
      if (lowHighGrid) lowHighGrid.before(helper);
    }

    function clearManualForMarket() {
      const p = selectedPrediction();
      const market = selectedMarket();
      if (!p || p.score) return;

      if (actualBias) actualBias.value = '';
      if (actualOpening) actualOpening.value = '';
      if (actualDayType) actualDayType.value = '';
      if (actualLow) actualLow.value = '';
      if (actualHigh) actualHigh.value = '';

      if (helper) {
        helper.textContent = `${market?.display_name || 'Selected market'} forecast levels: support ${p.support ?? '—'} · resistance ${p.resistance ?? '—'}. Enter the actual session low and high for this same market.`;
      }
    }

    const resultSelect = document.getElementById('resultIndexSelect');
    resultSelect?.addEventListener('change', () => {
      window.setTimeout(clearManualForMarket, 0);
    });

    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-score-history-entry]');
      if (!button) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const dialog = document.getElementById('historyEntryDialog');
      const heading = dialog?.querySelector('.history-entry-head h2')?.textContent || '';
      const marketName = heading.split(' · ')[0].trim();
      const market = (typeof indices !== 'undefined' ? indices : []).find(item => item.display_name === marketName);
      if (!market) return;

      selectedIndexId = market.id;
      const mainSelector = document.getElementById('indexSelect');
      if (mainSelector) mainSelector.value = selectedIndexId;
      dialog?.close();

      if (typeof navigate === 'function') navigate('result');

      window.setTimeout(() => {
        const resultMarketSelect = document.getElementById('resultIndexSelect');
        if (resultMarketSelect && [...resultMarketSelect.options].some(option => option.value === selectedIndexId)) {
          resultMarketSelect.value = selectedIndexId;
          resultMarketSelect.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          try {
            if (typeof renderAll === 'function') renderAll();
            if (typeof showSelectedResultState === 'function') showSelectedResultState();
          } catch (_) {}
        }
      }, 30);
    }, true);

    actualForm.addEventListener('submit', event => {
      const market = selectedMarket();
      const p = selectedPrediction();
      const marketName = market?.display_name || 'selected market';

      if (!p) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(`No locked prediction was found for ${marketName}.`);
        return;
      }

      if (!actualBias?.value || !actualOpening?.value || !actualDayType?.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(`Select the actual direction, opening and day type for ${marketName}.`);
        return;
      }

      const low = Number(actualLow?.value);
      const high = Number(actualHigh?.value);
      if (!Number.isFinite(low) || !Number.isFinite(high) || low <= 0 || high <= 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(`Enter the actual session low and high for ${marketName}. These are market prices, not the forecast support/resistance values.`);
        return;
      }

      if (high < low) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(`${marketName}: Actual high (${high}) cannot be below actual low (${low}). Please swap or correct the two values.`);
      }
    }, true);

    window.setTimeout(clearManualForMarket, 0);
  });
})();
