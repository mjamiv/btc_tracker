/* ------------------------------------------------------------------
   BTC Tracker – dynamic cost basis + purchases + cumulative gain
   UI has been refined; core logic preserved.
   ------------------------------------------------------------------ */

// Annotations for key dates (edit as needed)
const keyEvents = [
  {
    date: '2024-04-20',
    label: '4th Halving',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: { rotation: 270, position: 'end', color: '#F7931A', backgroundColor: '#FFFFFF', font: { size: 12 } }
  },
  {
    date: '2024-01-04',
    label: 'US ETF Launch',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: { rotation: 270, position: 'end', color: '#0052FE', backgroundColor: '#FFFFFF', font: { size: 12 } }
  },
  {
    date: '2024-11-05',
    label: 'US Pres. Election',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: { rotation: 270, position: 'end', color: '#FF0000', backgroundColor: '#FFFFFF', font: { size: 12 } }
  }
];

let priceChart = null;
let originalPriceData = [];
let originalCostBasisData = [];
let originalPurchaseData = [];
let originalGainData = [];

/* ----------------------------- Utilities */
const $ = (id) => document.getElementById(id);
const fmtUSD = (n) => (isFinite(n) ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : '—');
const fmtNum = (n, d = 2) => (isFinite(n) ? Number(n).toFixed(d) : '—');

function safeNumber(v) {
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/* ----------------------------- CSV fetch */
async function fetchCSV(url) {
  const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'cache=' + Date.now());
  if (!res.ok) throw new Error(`Failed to load ${url} (status ${res.status})`);
  const text = await res.text();
  return new Promise((resolve) =>
    Papa.parse(text, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data) })
  );
}

/* ----------------------------- BTC market metrics */
async function getBtcMetrics() {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin');
    if (!res.ok) throw new Error(`CoinGecko status ${res.status}`);
    const btc = (await res.json())[0];
    return {
      currentPrice: safeNumber(btc.current_price),
      marketCap: safeNumber(btc.market_cap),
      volume24h: safeNumber(btc.total_volume),
      priceChange24h: safeNumber(btc.price_change_percentage_24h)
    };
  } catch (e) {
    console.error('BTC metrics fallback', e);
    return { currentPrice: 69420, marketCap: 0, volume24h: 0, priceChange24h: 0 };
  }
}

/* ----------------------------- Blockchain metrics */
async function getBlockchainMetrics() {
  try {
    const [h, d, r, s] = await Promise.all([
      fetch('https://blockchain.info/q/getblockcount'),
      fetch('https://blockchain.info/q/getdifficulty'),
      fetch('https://blockchain.info/q/bcperblock'),
      fetch('https://blockchain.info/stats?format=json')
    ]);
    if (![h, d, r, s].every((x) => x.ok)) throw new Error('Blockchain API call failed');
    return {
      blockHeight: Number(await h.text()),
      difficulty: Number(await d.text()),
      blockReward: Number(await r.text()),
      hashRate: Number((await s.json()).hash_rate) / 1e9 // EH/s
    };
  } catch (e) {
    console.error('Blockchain metrics fallback', e);
    return { blockHeight: 514714, difficulty: 110.57e12, blockReward: 3.521, hashRate: 200 };
  }
}

/* ----------------------------- Portfolio helpers */
function buildCostBasisTimeline(purchases) {
  const sorted = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  let btc = 0, cost = 0;
  return sorted.map((p) => {
    btc += p.quantity;
    cost += p.totalCost;
    return {
      timestamp: new Date(p.timestamp + ' UTC'),
      costBasis: btc ? cost / btc : 0,
      totalBtc: btc
    };
  });
}

function buildGainSeries(costTimeline, hist) {
  return hist
    .map((row) => {
      const ts = new Date(row.Date);
      const price = parseFloat(String(row.Price || '').replace(/[^0-9.]/g, ''));
      const last = costTimeline.filter((t) => t.timestamp <= ts).slice(-1)[0] || { costBasis: 0, totalBtc: 0 };
      const gain = last.totalBtc ? (price - last.costBasis) * last.totalBtc : 0;
      return { x: ts, y: gain };
    })
    .filter((p) => !isNaN(p.x) && !isNaN(p.y));
}

/* ----------------------------- Filter by slider range */
function filterDataByDateRange(s, e) {
  const within = (arr) => arr.filter((pt) => pt.x >= s && pt.x <= e);
  const byEx = (name) => (p) => p.exchange.toLowerCase().trim() === name;

  const priceData = within(originalPriceData);
  const cbData = within(originalCostBasisData);
  const coinbaseData = within(originalPurchaseData.filter(byEx('coinbase')));
  const geminiData = within(originalPurchaseData.filter(byEx('gemini')));
  const venmoData = within(originalPurchaseData.filter(byEx('venmo')));
  const coinbitsData = within(originalPurchaseData.filter(byEx('coinbits')));
  const gainData = within(originalGainData);

  priceChart.data.datasets[0].data = priceData;
  priceChart.data.datasets[1].data = cbData;

  // Purchases: keep dynamic radii
  priceChart.data.datasets[2].data = coinbaseData;
  priceChart.data.datasets[2].pointRadius = coinbaseData.map((p) => p.radius);
  priceChart.data.datasets[2].pointHoverRadius = coinbaseData.map((p) => p.hoverRadius);

  priceChart.data.datasets[3].data = geminiData;
  priceChart.data.datasets[3].pointRadius = geminiData.map((p) => p.radius);
  priceChart.data.datasets[3].pointHoverRadius = geminiData.map((p) => p.hoverRadius);

  priceChart.data.datasets[4].data = venmoData;
  priceChart.data.datasets[4].pointRadius = venmoData.map((p) => p.radius);
  priceChart.data.datasets[4].pointHoverRadius = venmoData.map((p) => p.hoverRadius);

  priceChart.data.datasets[5].data = coinbitsData;
  priceChart.data.datasets[5].pointRadius = coinbitsData.map((p) => p.radius);
  priceChart.data.datasets[5].pointHoverRadius = coinbitsData.map((p) => p.hoverRadius);

  priceChart.data.datasets[6].data = gainData;

  priceChart.update();
}

/* ----------------------------- Range slider */
function initializeSlider(minDate, maxDate) {
  const slider = $('date-range-slider');
  const labels = $('date-range-labels');
  if (!slider || typeof noUiSlider === 'undefined') {
    // Hide if unavailable
    slider?.style && (slider.style.display = 'none');
    labels?.style && (labels.style.display = 'none');
    return;
  }
  noUiSlider.create(slider, {
    start: [minDate.getTime(), maxDate.getTime()],
    connect: true,
    range: { min: minDate.getTime(), max: maxDate.getTime() },
    step: 24 * 60 * 60 * 1000,
    behaviour: 'drag'
  });
  slider.noUiSlider.on('update', (v) => {
    const [s, e] = v.map((n) => new Date(+n));
    labels.innerHTML =
      `<span>${s.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` +
      `<span>${e.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
    filterDataByDateRange(s, e);
  });
  labels.innerHTML =
    `<span>${minDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>` +
    `<span>${maxDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
}

/* ----------------------------- Main refresh */
async function updateTracker() {
  try {
    // Register annotation plugin safely (Chart.js v4)
    const ann = window['chartjs-plugin-annotation'] || window.ChartAnnotation;
    if (ann && !Chart.registry.plugins.get('annotation')) {
      Chart.register(ann);
    }

    // Load CSVs
    const [transactions, historic] = await Promise.all([
      fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv'),
      fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv')
    ]);

    // Metrics
    const [btcMetrics, blockchainMetrics] = await Promise.all([getBtcMetrics(), getBlockchainMetrics()]);
    const currentPrice = btcMetrics.currentPrice;

    // Purchases
    const purchases = transactions
      .map((r) => ({
        timestamp: r.Timestamp,
        quantity: +r['Quantity Transacted'],
        totalCost: +String(r['Total'] || '').replace(/[^0-9.]/g, ''),
        priceAtTransaction: +String(r['Price at Transaction'] || '').replace(/[^0-9.]/g, ''),
        exchange: (r.Exchange || '').trim()
      }))
      .filter((p) => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction) && p.exchange);

    // Portfolio math
    const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
    const invested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
    const costBasis = totalBtc ? invested / totalBtc : 0;
    const currentVal = totalBtc * currentPrice;
    const gainLoss = currentVal - invested;
    const gainPct = invested ? (gainLoss / invested) * 100 : 0;

    // Split tile: "To 1 BTC"
    const btcRemaining = Math.max(1 - totalBtc, 0);
    const costToOne = btcRemaining * currentPrice;

    // DOM update
    $('btc-to-one').textContent = `${fmtNum(btcRemaining, 8)} BTC`;
    $('usd-to-one').textContent = fmtUSD(costToOne);

    $('total-btc').textContent = fmtNum(totalBtc, 8);
    $('invested').textContent = fmtUSD(invested);
    $('cost-basis').textContent = fmtUSD(costBasis);
    $('current-value').textContent = fmtUSD(currentVal);
    $('gain-loss').innerHTML =
      `<span class="${gainLoss >= 0 ? 'positive' : 'negative'}">` +
      `${gainLoss >= 0 ? '+' : ''}${fmtUSD(Math.abs(gainLoss))} ` +
      `<span class="percentage">(${(gainPct).toFixed(2)}%)</span>` +
      `</span>`;

    // BTC market tiles
    $('btc-price').textContent = fmtUSD(currentPrice);
    $('btc-market-cap').textContent = fmtUSD(btcMetrics.marketCap);
    $('btc-volume').textContent = fmtUSD(btcMetrics.volume24h);
    $('btc-price-change').innerHTML =
      `<span class="${btcMetrics.priceChange24h >= 0 ? 'positive' : 'negative'}">` +
      `${btcMetrics.priceChange24h >= 0 ? '+' : ''}${btcMetrics.priceChange24h.toFixed(2)}%` +
      `</span>`;

    // Chain tiles
    $('btc-block-height').textContent = safeNumber(blockchainMetrics.blockHeight).toLocaleString();
    $('btc-difficulty').textContent = (safeNumber(blockchainMetrics.difficulty) / 1e12).toFixed(2) + ' T';
    $('btc-hash-rate').textContent = safeNumber(blockchainMetrics.hashRate).toFixed(2) + ' EH/s';
    $('btc-block-reward').textContent = safeNumber(blockchainMetrics.blockReward).toFixed(3) + ' BTC';

    // Transaction table
    const tableBody = $('transactions-body');
    if (tableBody) {
      tableBody.innerHTML = '';
      purchases
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach((p) => {
          const tr = document.createElement('tr');
          tr.innerHTML =
            `<td>${new Date(p.timestamp).toLocaleDateString()}</td>` +
            `<td>${fmtNum(p.quantity, 8)}</td>` +
            `<td>${fmtUSD(p.totalCost)}</td>` +
            `<td>${fmtUSD(p.priceAtTransaction)}</td>` +
            `<td>${p.exchange}</td>`;
          tableBody.appendChild(tr);
        });
    }

    // Build chart data
    originalPriceData = historic
      .map((r) => {
        const ts = new Date(r.Date);
        const y = +String(r.Price || '').replace(/[^0-9.]/g, '');
        return { x: ts, y };
      })
      .filter((pt) => !isNaN(pt.x) && !isNaN(pt.y));

    const maxQty = Math.max(...purchases.map((p) => p.quantity), 0);
    originalPurchaseData = purchases.map((p) => {
      const ts = new Date(p.timestamp);
      const frac = maxQty ? Math.log1p(p.quantity / maxQty) / Math.log1p(1 + 1) : 0; // normalize 0..1
      const rMin = 4, rMax = 20;
      const r = rMin + frac * (rMax - rMin);
      return {
        x: ts,
        y: p.priceAtTransaction,
        quantity: p.quantity,
        cost: p.totalCost,
        radius: r,
        hoverRadius: r + 2,
        exchange: p.exchange
      };
    });

    const costTimeline = buildCostBasisTimeline(purchases);
    originalCostBasisData = originalPriceData.map((pt) => {
      const last = costTimeline.filter((t) => t.timestamp <= pt.x).slice(-1)[0] || { costBasis: 0 };
      return { x: pt.x, y: last.costBasis };
    });

    originalGainData = buildGainSeries(costTimeline, historic);
    const y1Max = Math.max(0, ...originalGainData.map((d) => d.y)) * 1.5 || 1;

    // Create / refresh chart
    if (priceChart) priceChart.destroy();
    const ctx = $('priceChart')?.getContext('2d');
    if (!ctx) throw new Error('Chart canvas not found');

    // Fancy gradient line fills (subtle)
    const gPrice = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gPrice.addColorStop(0, 'rgba(255,255,255,0.25)');
    gPrice.addColorStop(1, 'rgba(255,255,255,0.02)');

    const gGain = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height);
    gGain.addColorStop(0, 'rgba(57,255,20,0.35)');
    gGain.addColorStop(1, 'rgba(57,255,20,0.04)');

    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          // 0: BTC Price
          {
            label: 'BTC Price (USD)',
            data: originalPriceData,
            borderColor: '#e8eefc',
            backgroundColor: gPrice,
            fill: false,
            tension: 0.28,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: 'y',
            order: 1
          },
          // 1: Cost Basis
          {
            label: 'Cost Basis (USD)',
            data: originalCostBasisData,
            borderColor: '#ffd36b',
            backgroundColor: 'rgba(255,211,107,0.08)',
            borderDash: [6, 4],
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: 'y',
            order: 1
          },
          // 2..5: Purchases by exchange (scatter)
          {
            label: 'Coinbase Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter((p) => p.exchange.toLowerCase().trim() === 'coinbase'),
            backgroundColor: '#1E90FF',
            borderColor: '#0b1020',
            borderWidth: 1,
            pointRadius: (ctx) => ctx.raw?.radius ?? 6,
            pointHoverRadius: (ctx) => ctx.raw?.hoverRadius ?? 8,
            yAxisID: 'y',
            order: 0
          },
          {
            label: 'Gemini Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter((p) => p.exchange.toLowerCase().trim() === 'gemini'),
            backgroundColor: '#800080',
            borderColor: '#0b1020',
            borderWidth: 1,
            pointRadius: (ctx) => ctx.raw?.radius ?? 6,
            pointHoverRadius: (ctx) => ctx.raw?.hoverRadius ?? 8,
            yAxisID: 'y',
            order: 0
          },
          {
            label: 'Venmo Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter((p) => p.exchange.toLowerCase().trim() === 'venmo'),
            backgroundColor: '#00FF7F',
            borderColor: '#0b1020',
            borderWidth: 1,
            pointRadius: (ctx) => ctx.raw?.radius ?? 6,
            pointHoverRadius: (ctx) => ctx.raw?.hoverRadius ?? 8,
            yAxisID: 'y',
            order: 0
          },
          {
            label: 'Coinbits Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter((p) => p.exchange.toLowerCase().trim() === 'coinbits'),
            backgroundColor: '#FFD700',
            borderColor: '#0b1020',
            borderWidth: 1,
            pointRadius: (ctx) => ctx.raw?.radius ?? 6,
            pointHoverRadius: (ctx) => ctx.raw?.hoverRadius ?? 8,
            yAxisID: 'y',
            order: 0
          },
          // 6: Cumulative Gain (secondary axis)
          {
            label: 'Cumulative Gain (USD)',
            data: originalGainData,
            borderColor: '#39FF14',
            backgroundColor: gGain,
            fill: false,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
            yAxisID: 'y1',
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
            title: { display: true, text: 'Date', color: '#e6ecff', font: { size: 13, weight: '700' } },
            grid: { color: '#223152' },
            ticks: { color: '#d7def0' },
            min: '2022-01-01'
          },
          y: {
            title: { display: true, text: 'Price (USD)', color: '#e6ecff', font: { size: 13, weight: '700' } },
            grid: { color: '#1b2640' },
            ticks: {
              color: '#d7def0',
              callback: (v) => fmtUSD(Number(v)).replace('.00', '')
            },
            suggestedMax: 150000,
            suggestedMin: 0
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Cumulative Gain (USD)', color: '#e6ecff', font: { size: 13, weight: '700' } },
            grid: { drawOnChartArea: false },
            ticks: {
              color: '#d7def0',
              callback: (v) => fmtUSD(Number(v)).replace('.00', '')
            },
            suggestedMax: y1Max,
            suggestedMin: 0
          }
        },
        plugins: {
          legend: {
            labels: { color: '#e6ecff', font: { size: 12, weight: '600' }, usePointStyle: true, pointStyle: 'circle' }
          },
          tooltip: {
            backgroundColor: 'rgba(5,10,20,0.92)',
            titleColor: '#fff',
            bodyColor: '#e9eefc',
            borderColor: '#223152',
            borderWidth: 1,
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const lbl = ctx.dataset.label || '';
                if (['Coinbase Purchases','Gemini Purchases','Venmo Purchases','Coinbits Purchases'].includes(lbl)) {
                  const p = ctx.raw || {};
                  return `${lbl}: Bought ${fmtNum(p.quantity, 8)} BTC for ${fmtUSD(p.cost)}`;
                }
                if (lbl === 'Cumulative Gain (USD)') return `Gain: ${fmtUSD(ctx.parsed.y)}`;
                if (lbl === 'Cost Basis (USD)') return `Cost Basis: ${fmtUSD(ctx.parsed.y)}`;
                return `Price: ${fmtUSD(ctx.parsed.y)}`;
              }
            }
          },
          annotation: {
            annotations: keyEvents.reduce((map, ev, i) => {
              map['event' + i] = {
                type: 'line',
                xScaleID: 'x',
                xMin: ev.date,
                xMax: ev.date,
                borderColor: ev.borderColor || '#FF4500',
                borderWidth: ev.borderWidth || 2,
                borderDash: ev.borderDash || [],
                label: {
                  display: true,
                  content: ev.label,
                  position: ev.labelOptions?.position || 'start',
                  rotation: ev.labelOptions?.rotation || 90,
                  color: ev.labelOptions?.color || '#fff',
                  backgroundColor: ev.labelOptions?.backgroundColor || '#FFFFFF',
                  font: ev.labelOptions?.font || { size: 12 }
                }
              };
              return map;
            }, {})
          }
        }
      }
    });

    // Date range slider: keep available without changing core default behavior
    // Uncomment to enable by default:
    // initializeSlider(new Date('2022-01-01'), new Date());

  } catch (e) {
    console.error(e);
    $('chart-error').innerText = `Error: ${e.message}`;
  }
}

// Initial load
updateTracker();
