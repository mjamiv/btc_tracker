/* ------------------------------------------------------------------
   BTC Tracker – dynamic per-day Cost Basis line
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

/* ───────────────────────────── Helpers */
function buildCostBasisTimeline(purchases) {
  const sorted = [...purchases].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
  let btc = 0, cost = 0;
  return sorted.map(p => {
    btc  += p.quantity;
    cost += p.totalCost;
    return {
      timestamp: new Date(p.timestamp),
      costBasis: btc ? cost / btc : 0,
      totalBtc : btc
    };
  });
}

function buildGainSeries(costTimeline, hist) {
  return hist.map(row => {
    const ts    = new Date(row.Date);                                // YYYY-MM-DD in CSV
    const price = +row.Price;
    const last  = costTimeline.filter(t => t.timestamp <= ts).slice(-1)[0]
                || { costBasis: 0, totalBtc: 0 };
    const gain  = last.totalBtc ? (price - last.costBasis) * last.totalBtc : 0;
    return { x: ts, y: gain };
  });
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
        labels.innerHTML =
          `<span>${s.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` +
          `<span>${e.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
        filterDataByDateRange(s, e);
      });
      labels.innerHTML =
        `<span>${minDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` +
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
      fetchCSV('transactions.csv'),                                   // point at the cleaned file
      fetchCSV('historical_btc_prices.csv')
    ]);

    /* ---------- Purchases ---------- */
    const purchases = transactions.map(r => ({
      timestamp : r.Timestamp,                                        // already ISO
      quantity  : +r['Quantity Transacted'],
      totalCost : +r.Total,
      priceAtTransaction : +r['Price at Transaction'],
      exchange  : r.Exchange
    })).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction));

    /* ---------- Time-series ---------- */
    originalPriceData = historic.map(r => ({
      x: new Date(r.Date),                                            // YYYY-MM-DD in file
      y: +r.Price
    }));

    const maxQty = Math.max(...purchases.map(p => p.quantity));
    originalPurchaseData = purchases.map(p => {
      const ts   = new Date(p.timestamp);
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
    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          { label: 'BTC Price (USD)', data: originalPriceData, borderColor: '#fff', backgroundColor: 'rgba(255,255,255,0.03)', fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y', order: 1 },
          { label: 'Cost Basis (USD)', data: originalCostBasisData, borderColor: '#FFA500', backgroundColor: 'rgba(255,165,0,0.08)', borderDash: [6, 4], fill: false, tension: 0, pointRadius: 0, yAxisID: 'y', order: 1 },
          { label: 'Coinbase Purchases', data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase'), type: 'scatter', backgroundColor: '#1E90FF', pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase').map(p => p.radius), pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase').map(p => p.hoverRadius), borderColor: '#000', borderWidth: 1, yAxisID: 'y', order: 0 },
          { label: 'Gemini Purchases', data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini'), type: 'scatter', backgroundColor: '#800080', pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini').map(p => p.radius), pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini').map(p => p.hoverRadius), borderColor: '#000', borderWidth: 1, yAxisID: 'y', order: 0 },
          { label: 'Venmo Purchases', data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo'), type: 'scatter', backgroundColor: '#00FF00', pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo').map(p => p.radius), pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo').map(p => p.hoverRadius), borderColor: '#000', borderWidth: 1, yAxisID: 'y', order: 0 },
          { label: 'Cumulative Gain (USD)', data: originalGainData, borderColor: '#39FF14', backgroundColor: 'rgba(57,255,20,0.1)', fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1', order: 2 }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yy' } }, title: { display: true, text: 'Date', color: '#fff', font: { size: 14 } }, grid: { color: '#444' }, ticks: { color: '#fff' } },
          y: { title: { display: true, text: 'Price (USD)', color: '#fff', font: { size: 14 } }, grid: { color: '#444' }, ticks: { color: '#fff', callback: v => v.toLocaleString() } },
          y1: { position: 'right', title: { display: true, text: 'Cumulative Gain (USD)', color: '#fff', font: { size: 14 } }, grid: { drawOnChartArea: false }, ticks: { color: '#fff', callback: v => v.toLocaleString() }, suggestedMax: Math.max(...originalGainData.map(d => d.y)) * 1.25 }
        },
        plugins: {
          legend: { labels: { color: '#fff', font: { size: 12 } } },
          tooltip: {
            backgroundColor: 'rgba(0,0,0,0.8)',
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
              label: ctx => {
                const lbl = ctx.dataset.label;
                if (['Coinbase Purchases', 'Gemini Purchases', 'Venmo Purchases'].includes(lbl)) {
                  const p = ctx.raw;
                  return `${lbl}: Bought ${p.quantity.toFixed(8)} BTC for ${p.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
                }
                if (lbl === 'Cumulative Gain (USD)') return `Gain: ${ctx.parsed.y.toLocaleString()}`;
                if (lbl === 'Cost Basis (USD)')       return `Cost Basis: ${ctx.parsed.y.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
                return `Price: ${ctx.parsed.y.toLocaleString()}`;
              }
            }
          }
        }
      }
    });

    /* ---------- Transaction table ---------- */
    const tableBody = document.getElementById('transactions-body');
    if (tableBody) {
      tableBody.innerHTML = '';
      purchases
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach(p => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${new Date(p.timestamp).toLocaleDateString()}</td>
            <td>${p.quantity.toFixed(8)}</td>
            <td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
            <td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
            <td>${p.exchange}</td>`;
          tableBody.appendChild(tr);
        });
    }

    /* ---------- Slider ---------- */
    initializeSlider(
      new Date(Math.min(...originalPriceData.map(d => d.x))),
      new Date(new Date().setDate(new Date().getDate() + 60))
    );

    /* ---------- Summary boxes ---------- */
    const currentPrice      = (await getBtcMetrics()).currentPrice;
    const totalBtc          = purchases.reduce((s, p) => s + p.quantity, 0);
    const invested          = purchases.reduce((s, p) => s + p.totalCost, 0);
    const costBasis         = totalBtc ? invested / totalBtc : 0;
    const currentVal        = totalBtc * currentPrice;
    const gainLoss          = currentVal - invested;
    const gainPct           = invested ? (gainLoss / invested) * 100 : 0;

    const $ = id => document.getElementById(id);
    $('total-btc').innerText   = totalBtc.toFixed(8);
    $('invested').innerText    = invested.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    $('cost-basis').innerText  = costBasis.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    $('current-value').innerText = currentVal.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
    $('gain-loss').innerHTML = `<span class="${gainLoss >= 0 ? 'positive' : 'negative'}">
                                  ${gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                                  <span class="percentage">(${gainPct.toFixed(2)}%)</span>
                                </span>`;
  } catch (e) {
    console.error(e);
    document.getElementById('chart-error').innerText = `Error: ${e.message}`;
  }
}

/* ───────────────────────────── on-load */
updateTracker();
