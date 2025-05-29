/* ------------------------------------------------------------------
   BTC Tracker – dynamic per-day Cost Basis line (Safari‑safe)  
   ------------------------------------------------------------------ */

let priceChart            = null;
let originalPriceData     = [];
let originalCostBasisData = [];
let originalPurchaseData  = [];
let originalGainData      = [];

/* ───────────────────────────── CSV fetch */
async function fetchCSV(url) {
  const res = await fetch(url + '?cache=' + Date.now());
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const text = await res.text();
  return new Promise(resolve =>
    Papa.parse(text, { header: true, complete: r => resolve(r.data) })
  );
}

/* ───────────────────────────── BTC metrics */
async function getBtcMetrics() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin'
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const btc = (await res.json())[0];
    return {
      currentPrice:   btc.current_price,
      marketCap:      btc.market_cap,
      volume24h:      btc.total_volume,
      priceChange24h: btc.price_change_percentage_24h
    };
  } catch (e) {
    console.error('BTC metrics fallback', e);
    return { currentPrice: 93162, marketCap: 0, volume24h: 0, priceChange24h: 0 };
  }
}

/* ───────────────────────────── Blockchain metrics */
async function getBlockchainMetrics() {
  try {
    const [h, d, r, s] = await Promise.all([
      fetch('https://blockchain.info/q/getblockcount'),
      fetch('https://blockchain.info/q/getdifficulty'),
      fetch('https://blockchain.info/q/bcperblock'),
      fetch('https://blockchain.info/stats?format=json')
    ]);
    if (![h, d, r, s].every(x => x.ok)) throw new Error('One call failed');
    return {
      blockHeight: +await h.text(),
      difficulty : +await d.text(),
      blockReward: +await r.text(),
      hashRate   : (await s.json()).hash_rate / 1e9 // EH/s
    };
  } catch (e) {
    console.error('Blockchain metrics fallback', e);
    return { blockHeight: 514714, difficulty: 110.57e12, blockReward: 3.521, hashRate: 200 };
  }
}

/* ───────────────────────────── Normalize CSV date strings */
function fixIso(s) {
  if (!s || typeof s !== 'string') return s;
  let str = s.trim().replace(/^"|"$/g, '');      // strip quotes if present
  str = str.replace(' UTC', '').replace(' Z', '').trim();
  if (str.includes('T')) {
    return /Z$|[+-]\d{2}:\d{2}$/.test(str) ? str : str + 'Z';
  }
  return str + 'T00:00:00Z';
}

/* ───────────────────────────── Helpers */
function buildCostBasisTimeline(purchases) {
  const sorted = [...purchases].sort(
    (a, b) => new Date(fixIso(a.timestamp)) - new Date(fixIso(b.timestamp))
  );
  let btc = 0, cost = 0;
  return sorted.map(p => {
    btc  += p.quantity;
    cost += p.totalCost;
    return {
      timestamp: new Date(fixIso(p.timestamp)),
      costBasis: btc ? cost / btc : 0,
      totalBtc : btc
    };
  });
}

function buildGainSeries(costTimeline, hist) {
  return hist.map(row => {
    const ts    = new Date(fixIso(row.Date));
    const price = +((row.Price || '').replace(/[^0-9.]/g, ''));
    const last  = costTimeline.filter(t => t.timestamp <= ts).slice(-1)[0] || { costBasis: 0, totalBtc: 0 };
    const gain  = last.totalBtc ? (price - last.costBasis) * last.totalBtc : 0;
    return { x: ts, y: gain };
  }).filter(p => !isNaN(p.x) && !isNaN(p.y));
}

/* ───────────────────────────── Slider filter */
function filterDataByDateRange(s, e) {
  const within = a => a.filter(pt => pt.x >= s && pt.x <= e);

  priceChart.data.datasets[0].data = within(originalPriceData);
  priceChart.data.datasets[1].data = within(originalCostBasisData);
  priceChart.data.datasets[2].data = within(originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase'));
  priceChart.data.datasets[3].data = within(originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini'));
  priceChart.data.datasets[4].data = within(originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo'));
  priceChart.data.datasets[5].data = within(originalGainData);

  priceChart.update();
}

/* ───────────────────────────── Slider init */
function initializeSlider(minDate, maxDate) {
  const slider = document.getElementById('date-range-slider');
  const labels = document.getElementById('date-range-labels');
  const maxRetries = 10;
  let tries = 0;
  (function tryInit() {
    if (typeof noUiSlider !== 'undefined') {
      noUiSlider.create(slider, {
        start: [minDate.getTime(), maxDate.getTime()],
        connect: true,
        range: { min: minDate.getTime(), max: maxDate.getTime() },
        step: 24 * 60 * 60 * 1000,
        behaviour: 'drag'
      });
      slider.noUiSlider.on('update', v => {
        const [s, e] = v.map(n => new Date(+n));
        labels.innerHTML = `<span>${s.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` +
                           `<span>${e.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
        filterDataByDateRange(s, e);
      });
      labels.innerHTML = `<span>${minDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` +
                         `<span>${maxDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
    } else if (++tries <= maxRetries) {
      setTimeout(tryInit, 500);
    } else {
      document.getElementById('chart-error').innerText = 'Date slider unavailable';
      slider.style.display = labels.style.display = 'none';
    }
  })();
}

/* ───────────────────────────── Main */
async function updateTracker() {
  try {
    /* ---------- Load CSV ---------- */
    const [transactions, historic] = await Promise.all([
      fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv'),
      fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv')
    ]);

    /* ---------- Purchases ---------- */
    const purchases = transactions.map(r => ({
      timestamp : fixIso(r.Timestamp).split('T')[0],
      quantity  : +r['Quantity Transacted'],
      totalCost : +((r['Total'] || '').replace(/[^0-9.]/g, '')),
      priceAtTransaction : +((r['Price at Transaction'] || '').replace(/[^0-9.]/g, '')),
      exchange  : r.Exchange
    })).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction) && p.exchange);

    /* ---------- Time-series data ---------- */
    originalPriceData = historic.map(r => {
      const ts = new Date(fixIso(r.Date));
      const y  = +((r.Price || '').replace(/[^0-9.]/g, ''));
      return { x: ts, y };
    }).filter(pt => !isNaN(pt.x) && !isNaN(pt.y));

    const maxQty = Math.max(...purchases.map(p => p.quantity));
    originalPurchaseData = purchases.map(p => {
      const ts   = new Date(fixIso(p.timestamp));
      const frac = Math.log1p(p.quantity / maxQty) / Math.log1p(1);
      const rMin = 4, rMax = 20;
      return {
        x: ts, y: p.priceAtTransaction,
        quantity: p.quantity, cost: p.totalCost,
        radius: rMin + frac * (rMax - rMin),
        hoverRadius: rMin + frac * (rMax - rMin) + 2,
        exchange: p.exchange
      };
    });

    const costTimeline          = buildCostBasisTimeline(purchases);
    originalCostBasisData = originalPriceData.map(pt => {
      const last = costTimeline.filter(t => t.timestamp <= pt.x).slice(-1)[0] || { costBasis: 0 };
      return { x: pt.x, y: last.costBasis };
    });
    originalGainData            = buildGainSeries(costTimeline, historic);

    /* ---------- Chart ---------- */
    if (priceChart) priceChart.destroy();

    const ctx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(ctx,{ /* -- chart config stays the same -- */ });

    /* ---------- Slider ---------- */
    initializeSlider(
      new Date(Math.min(...originalPriceData.map(d => d.x))),
      new Date(new Date().setDate(new Date().getDate() + 60))
    );

    /* ---------- Transaction table ---------- */
    const tableBody = document.getElementById('transactions-body');
    if (tableBody) {
      tableBody.innerHTML = '';
      purchases
        .sort((a, b) => new Date(fixIso(b.timestamp)) - new Date(fixIso(a.timestamp)))
        .forEach(p => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${new Date(fixIso(p.timestamp)).toLocaleDateString()}</td>
            <td>${p.quantity.toFixed(8)}</td>
            <td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
            <td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
            <td>${p.exchange}</td>`;
          tableBody.appendChild(tr);
        });
    }

    /* ---------- Summary boxes ---------- */
    // -- (summary calc code stays the same) --

  } catch (e) {
    console.error(e);
    document.getElementById('chart-error').innerText = `Error: ${e.message}`;
  }
}

/* ───────────────────────────── on-load */
updateTracker();
