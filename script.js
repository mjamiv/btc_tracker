/* ------------------------------------------------------------------
   BTC Tracker — cleaned UI & structure, same core functionality
   ------------------------------------------------------------------ */

/* ---------- Config ---------- */
const CSV_URLS = {
  transactions: 'https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv',
  historical:   'https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv'
};

const EXCHANGE_STYLES = {
  coinbase: { label: 'Coinbase Purchases', color: '#1E90FF' },
  gemini:   { label: 'Gemini Purchases',   color: '#800080' },
  venmo:    { label: 'Venmo Purchases',    color: '#00FF00' },
  coinbits: { label: 'Coinbits Purchases', color: '#FFD700' }
};

// Vertical event markers on the chart
const keyEvents = [
  {
    date: '2024-04-20',
    label: '4th Halving',
    borderColor:  '#FFFFFF',
    borderWidth: 3,
    labelOptions: {
      rotation: 270, position: 'end', color: '#F7931A',
      backgroundColor: '#FFFFFF', font: { size: 12 }
    }
  },
  {
    date: '2024-01-04',
    label: 'US ETF Launch',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: {
      rotation: 270, position: 'end', color: '#0052FE',
      backgroundColor: '#FFFFFF', font: { size: 12 }
    }
  },
  {
    date: '2024-11-05',
    label: 'US Pres. Election',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: {
      rotation: 270, position: 'end', color: '#FF0000',
      backgroundColor: '#FFFFFF', font: { size: 12 }
    }
  }
];

/* ---------- State ---------- */
let priceChart = null;
let originalPriceData = [];
let originalCostBasisData = [];
let originalPurchaseData = [];
let originalGainData = [];

/* ---------- Utilities ---------- */
const $ = (id) => document.getElementById(id);

const fmtUSD = (v) =>
  (isFinite(v) ? v : 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

/* ---------- Data loaders ---------- */
async function fetchCSV(url) {
  const res = await fetch(url + '?cache=' + Date.now());
  if (!res.ok) throw new Error(`Failed to load ${url} (status ${res.status})`);
  const text = await res.text();
  return new Promise((resolve) =>
    Papa.parse(text, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data) })
  );
}

async function getBtcMetrics() {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin'
    );
    if (!res.ok) throw new Error(`CoinGecko status ${res.status}`);
    const btc = (await res.json())[0];
    return {
      currentPrice: btc.current_price,
      marketCap: btc.market_cap,
      volume24h: btc.total_volume,
      priceChange24h: btc.price_change_percentage_24h
    };
  } catch (e) {
    console.error('BTC metrics fallback', e);
    return { currentPrice: 69420, marketCap: 0, volume24h: 0, priceChange24h: 0 };
  }
}

async function getBlockchainMetrics() {
  try {
    const [h, d, r, s] = await Promise.all([
      fetch('https://blockchain.info/q/getblockcount'),
      fetch('https://blockchain.info/q/getdifficulty'),
      fetch('https://blockchain.info/q/bcperblock'),
      fetch('https://blockchain.info/stats?format=json')
    ]);
    if (![h, d, r, s].every((x) => x.ok)) throw new Error('Blockchain.info call failed');
    return {
      blockHeight: +(await h.text()),
      difficulty: +(await d.text()),
      blockReward: +(await r.text()),
      hashRate: (await s.json()).hash_rate / 1e9 // GH/s -> EH/s
    };
  } catch (e) {
    console.error('Blockchain metrics fallback', e);
    return { blockHeight: 514714, difficulty: 110.57e12, blockReward: 3.521, hashRate: 200 };
  }
}

/* ---------- Transform helpers ---------- */
function buildCostBasisTimeline(purchases) {
  const sorted = [...purchases].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );
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
      const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
      const last =
        costTimeline.filter((t) => t.timestamp <= ts).slice(-1)[0] ||
        { costBasis: 0, totalBtc: 0 };
      const gain = last.totalBtc ? (price - last.costBasis) * last.totalBtc : 0;
      return { x: ts, y: gain };
    })
    .filter((p) => !isNaN(p.x) && !isNaN(p.y));
}

function dateExtent(points) {
  if (!points.length) return [new Date('2022-01-01'), new Date()];
  const xs = points.map((p) => +p.x);
  return [new Date(Math.min(...xs)), new Date(Math.max(...xs))];
}

/* ---------- Slider & filtering ---------- */
function filterDataByDateRange(s, e) {
  const within = (a) => a.filter((pt) => pt.x >= s && pt.x <= e);
  const priceData = within(originalPriceData);
  const cbData = within(originalCostBasisData);

  const partition = (name) =>
    within(originalPurchaseData.filter((p) => p.exchange.toLowerCase() === name));

  const coinbaseData = partition('coinbase');
  const geminiData   = partition('gemini');
  const venmoData    = partition('venmo');
  const coinbitsData = partition('coinbits');
  const gainData     = within(originalGainData);

  const ds = priceChart.data.datasets;

  ds[0].data = priceData;           // BTC price
  ds[1].data = cbData;              // Cost basis

  // Scatter series: keep variable point sizes
  ds[2].data = coinbaseData; ds[2].pointRadius = coinbaseData.map((p)=>p.radius); ds[2].pointHoverRadius = coinbaseData.map((p)=>p.hoverRadius);
  ds[3].data = geminiData;   ds[3].pointRadius = geminiData.map((p)=>p.radius);   ds[3].pointHoverRadius = geminiData.map((p)=>p.hoverRadius);
  ds[4].data = venmoData;    ds[4].pointRadius = venmoData.map((p)=>p.radius);    ds[4].pointHoverRadius = venmoData.map((p)=>p.hoverRadius);
  ds[5].data = coinbitsData; ds[5].pointRadius = coinbitsData.map((p)=>p.radius); ds[5].pointHoverRadius = coinbitsData.map((p)=>p.hoverRadius);

  ds[6].data = gainData;            // Cumulative gain

  priceChart.update();
}

function initializeSlider(minDate, maxDate) {
  const slider = $('date-range-slider');
  const labels = $('date-range-labels');

  if (slider.noUiSlider) slider.noUiSlider.destroy();

  noUiSlider.create(slider, {
    start: [minDate.getTime(), maxDate.getTime()],
    connect: true,
    range: { min: minDate.getTime(), max: maxDate.getTime() },
    step: 24 * 60 * 60 * 1000,
    behaviour: 'drag'
  });

  const renderLabels = (s, e) => {
    labels.innerHTML =
      `<span>${s.toLocaleDateString('en-US', { month:'short', year:'numeric' })}</span>` +
      `<span>${e.toLocaleDateString('en-US', { month:'short', year:'numeric' })}</span>`;
  };

  slider.noUiSlider.on('update', (v) => {
    const [s, e] = v.map((n) => new Date(+n));
    renderLabels(s, e);
    filterDataByDateRange(s, e);
  });

  renderLabels(minDate, maxDate);
}

/* ---------- Chart ---------- */
function buildAnnotations() {
  return keyEvents.reduce((map, ev, i) => {
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
  }, {});
}

function createScatterDataset(exchangeKey, order) {
  const style = EXCHANGE_STYLES[exchangeKey];
  const data = originalPurchaseData.filter(
    (p) => p.exchange.toLowerCase() === exchangeKey
  );
  return {
    label: style.label,
    type: 'scatter',
    data,
    backgroundColor: style.color,
    borderColor: '#000',
    borderWidth: 1,
    pointRadius: data.map((p) => p.radius),
    pointHoverRadius: data.map((p) => p.hoverRadius),
    yAxisID: 'y',
    order
  };
}

function applyPriceGradient(chart) {
  const ds = chart.data.datasets[0];
  const {ctx, chartArea} = chart;
  if (!chartArea) return;

  const grad = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, 'rgba(255,255,255,0.25)');
  ds.borderColor = grad;
}

/* ---------- Main ---------- */
async function updateTracker() {
  try {
    $('chart-error').textContent = '';

    // Load CSVs & APIs in parallel
    const [transactions, historic, btcMetrics, blockchainMetrics] = await Promise.all([
      fetchCSV(CSV_URLS.transactions),
      fetchCSV(CSV_URLS.historical),
      getBtcMetrics(),
      getBlockchainMetrics()
    ]);

    const currentPrice = btcMetrics.currentPrice;

    // Parse purchases
    const purchases = transactions
      .map((r) => ({
        timestamp: r.Timestamp,
        quantity: +r['Quantity Transacted'],
        totalCost: +((r['Total'] || '').replace(/[^0-9.]/g, '')),
        priceAtTransaction: +((r['Price at Transaction'] || '').replace(/[^0-9.]/g, '')),
        exchange: (r.Exchange || '').trim()
      }))
      .filter((p) =>
        p.exchange && isFinite(p.quantity) && isFinite(p.totalCost) && isFinite(p.priceAtTransaction)
      );

    // Portfolio math
    const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
    const invested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
    const costBasis = totalBtc ? invested / totalBtc : 0;
    const currentVal = totalBtc * currentPrice;
    const gainLoss  = currentVal - invested;
    const gainPct   = invested ? (gainLoss / invested) * 100 : 0;

    // To 1 BTC tile
    const btcRemaining = Math.max(1 - totalBtc, 0);
    const costToOne    = btcRemaining * currentPrice;

    setText('btc-to-one', `${btcRemaining.toFixed(8)} BTC`);
    setText('usd-to-one', fmtUSD(costToOne));

    // Summary tiles
    setText('total-btc', totalBtc.toFixed(8));
    setText('invested', fmtUSD(invested));
    setText('cost-basis', fmtUSD(costBasis));
    setText('current-value', fmtUSD(currentVal));
    $('gain-loss').innerHTML =
      `<span class="${gainLoss >= 0 ? 'positive' : 'negative'}">` +
      `${gainLoss >= 0 ? '+' : ''}${fmtUSD(gainLoss)} ` +
      `<span class="percentage">(${gainPct.toFixed(2)}%)</span>` +
      `</span>`;

    // BTC market tiles
    setText('btc-price', fmtUSD(currentPrice));
    setText('btc-market-cap', fmtUSD(btcMetrics.marketCap));
    setText('btc-volume', fmtUSD(btcMetrics.volume24h));
    $('btc-price-change').innerHTML =
      `<span class="${btcMetrics.priceChange24h >= 0 ? 'positive' : 'negative'}">` +
      `${btcMetrics.priceChange24h >= 0 ? '+' : ''}${btcMetrics.priceChange24h.toFixed(2)}%` +
      `</span>`;

    // Chain tiles
    setText('btc-block-height', blockchainMetrics.blockHeight.toLocaleString());
    setText('btc-difficulty', (blockchainMetrics.difficulty / 1e12).toFixed(2) + ' T');
    setText('btc-hash-rate', blockchainMetrics.hashRate.toFixed(2) + ' EH/s');
    setText('btc-block-reward', blockchainMetrics.blockReward.toFixed(3) + ' BTC');

    // Transaction table (newest first)
    const tbody = $('transactions-body');
    if (tbody) {
      tbody.innerHTML = '';
      purchases
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .forEach((p) => {
          const tr = document.createElement('tr');
          tr.innerHTML =
            `<td>${new Date(p.timestamp).toLocaleDateString()}</td>` +
            `<td>${p.quantity.toFixed(8)}</td>` +
            `<td>${fmtUSD(p.totalCost)}</td>` +
            `<td>${fmtUSD(p.priceAtTransaction)}</td>` +
            `<td>${p.exchange}</td>`;
          tbody.appendChild(tr);
        });
    }

    // Build chart data
    originalPriceData = historic
      .map((r) => {
        const ts = new Date(r.Date);
        const y = +((r.Price || '').replace(/[^0-9.]/g, ''));
        return { x: ts, y };
      })
      .filter((pt) => !isNaN(pt.x) && !isNaN(pt.y));

    const maxQty = Math.max(...purchases.map((p) => p.quantity), 0);
    originalPurchaseData = purchases.map((p) => {
      const ts = new Date(p.timestamp);
      const frac = maxQty ? p.quantity / maxQty : 0;
      const rMin = 4, rMax = 20;
      const radius = rMin + Math.sqrt(frac) * (rMax - rMin); // smooth scaling
      return {
        x: ts,
        y: p.priceAtTransaction,
        quantity: p.quantity,
        cost: p.totalCost,
        radius,
        hoverRadius: radius + 2,
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
    const ctx = $('priceChart').getContext('2d');

    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          // 0: BTC Price
          {
            label: 'BTC Price (USD)',
            data: originalPriceData,
            borderColor: '#ffffff',
            backgroundColor: 'rgba(255,255,255,0.04)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'y',
            order: 1
          },
          // 1: Cost Basis
          {
            label: 'Cost Basis (USD)',
            data: originalCostBasisData,
            borderColor: '#FFA500',
            backgroundColor: 'rgba(255,165,0,0.08)',
            borderWidth: 2,
            borderDash: [6,4],
            fill: false,
            tension: 0,
            pointRadius: 0,
            yAxisID: 'y',
            order: 1
          },
          // 2..5: Purchases by exchange
          createScatterDataset('coinbase', 0),
          createScatterDataset('gemini',   0),
          createScatterDataset('venmo',    0),
          createScatterDataset('coinbits', 0),

          // 6: Cumulative Gain
          {
            label: 'Cumulative Gain (USD)',
            data: originalGainData,
            borderColor: '#39FF14',
            backgroundColor: 'rgba(57,255,20,0.08)',
            borderWidth: 2,
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'y1',
            order: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'nearest', intersect: false },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
            title: { display: true, text: 'Date', color: '#cfd8ff', font: { size: 13, weight: '600' } },
            grid: { color: 'rgba(255,255,255,0.08)' },
            ticks: { color: '#d8e1ff', maxRotation: 0, autoSkipPadding: 10 },
            min: '2022-01-01'
          },
          y: {
            title: { display: true, text: 'Price (USD)', color: '#cfd8ff', font: { size: 13, weight: '600' } },
            grid: { color: 'rgba(255,255,255,0.06)' },
            ticks: { color: '#d8e1ff', callback: (v) => v.toLocaleString() },
            suggestedMax: 150000,
            suggestedMin: 0
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Cumulative Gain (USD)', color: '#cfd8ff', font: { size: 13, weight: '600' } },
            grid: { drawOnChartArea: false },
            ticks: { color: '#d8e1ff', callback: (v) => v.toLocaleString() },
            suggestedMax: y1Max,
            suggestedMin: 0
          }
        },
        plugins: {
          legend: {
            labels: { color: '#e6ecff', font: { size: 12 } },
          },
          tooltip: {
            backgroundColor: 'rgba(5,8,16,0.9)',
            borderColor: 'rgba(255,255,255,0.08)',
            borderWidth: 1,
            titleColor: '#fff',
            bodyColor: '#fff',
            padding: 10,
            callbacks: {
              label: (ctx) => {
                const lbl = ctx.dataset.label;
                if (['Coinbase Purchases','Gemini Purchases','Venmo Purchases','Coinbits Purchases'].includes(lbl)) {
                  const p = ctx.raw;
                  return `${lbl}: ${p.quantity.toFixed(8)} BTC for ${fmtUSD(p.cost)}`;
                }
                if (lbl === 'Cumulative Gain (USD)') return `Gain: ${fmtUSD(ctx.parsed.y)}`;
                if (lbl === 'Cost Basis (USD)') return `Cost Basis: ${fmtUSD(ctx.parsed.y)}`;
                return `Price: ${fmtUSD(ctx.parsed.y)}`;
              }
            }
          },
          annotation: { annotations: buildAnnotations() }
        }
      },
      plugins: [{
        // price line gradient polish
        id: 'priceGradient',
        afterLayout: (chart) => applyPriceGradient(chart),
        resize:      (chart) => applyPriceGradient(chart),
        beforeDatasetsDraw: (chart) => applyPriceGradient(chart),
      }]
    });

    // Initialize date slider to data extents
    const [minDate, maxDate] = dateExtent(originalPriceData);
    initializeSlider(minDate, maxDate);

    // Last updated
    setText('last-updated', `Last updated: ${new Date().toLocaleString()}`);

  } catch (e) {
    console.error(e);
    setText('chart-error', `Error: ${e.message}`);
  }
}

/* ---------- Wire up ---------- */
$('refresh-btn').addEventListener('click', () => updateTracker());
updateTracker();
