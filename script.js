/* ------------------------------------------------------------------
   BTC Tracker – dynamic per-day Cost Basis line with Annotations
   ------------------------------------------------------------------
*/

// Dependencies (include before this script in your HTML):
// <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
// <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.0.1/dist/chartjs-plugin-annotation.min.js"></script>
// <script src="https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.3.2/papaparse.min.js"></script>
// <script src="https://cdnjs.cloudflare.com/ajax/libs/noUiSlider/15.7.1/nouislider.min.js"></script>

// Define key dates for vertical lines (modify as needed)
const keyEvents = [
  {
    date: '2024-04-20',
    label: '4th Halving',
    borderColor:  '#FFFFFF',
    borderWidth: 3,
    labelOptions: {
      rotation: 270,
      position: 'end',
      color: '#F7931A',
      backgroundColor: '#FFFFFF',
      font: { size: 12 }
    }
  },
  {
    date: '2024-01-04',
    label: 'US ETF Launch',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: {
      rotation: 270,
      position: 'end',
      color: '#0052FE',
      backgroundColor: '#FFFFFF',
      font: { size: 12 }
    }
  },
  {
    date: '2024-11-05',
    label: 'US Pres. Election',
    borderColor: '#FFFFFF',
    borderWidth: 3,
    labelOptions: {
      rotation: 270,
      position: 'end',
      color: '#FF0000',
      backgroundColor: '#FFFFFF',
      font: { size: 12 }
    }
  }
];

let priceChart = null;
let originalPriceData = [];
let originalCostBasisData = [];
let originalPurchaseData = [];
let originalGainData = [];

/* ───────────────────────────── CSV fetch */
async function fetchCSV(url) {
  const res = await fetch(url + '?cache=' + Date.now());
  if (!res.ok) throw new Error(`Failed to load ${url}`);
  const text = await res.text();
  return new Promise(resolve =>
    Papa.parse(text, { header: true, complete: r => resolve(r.data) })
  );
}

function parseUsd(value) {
  return +String(value || '').replace(/[^0-9.-]/g, '');
}

function parseTimestamp(value) {
  if (!value) return new Date(NaN);
  const raw = String(value).trim();
  const match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (match) {
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    const hour = +(match[4] || 0);
    const minute = +(match[5] || 0);
    const second = +(match[6] || 0);
    return new Date(year, month, day, hour, minute, second);
  }

  const parsed = new Date(raw);
  if (!isNaN(parsed.getTime())) return parsed;
  return new Date(raw.replace(' ', 'T') + 'Z');
}

function parseHistoricalDate(value) {
  if (!value) return new Date(NaN);
  const raw = String(value).trim();
  const match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const month = +match[1] - 1;
    const day = +match[2];
    const year = +match[3];
    return new Date(year, month, day);
  }

  const parsed = new Date(raw);
  return parsed;
}

function formatUsd(amount) {
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function normalizeTransactionRow(row) {
  return {
    Timestamp: String(row.Timestamp || '').trim(),
    'Quantity Transacted': String(row['Quantity Transacted'] || '').trim(),
    'Price Currency': String(row['Price Currency'] || 'USD').trim() || 'USD',
    'Price at Transaction': String(row['Price at Transaction'] || '').trim(),
    Subtotal: String(row.Subtotal || '').trim(),
    Total: String(row.Total || '').trim(),
    Fees: String(row.Fees || '').trim(),
    Exchange: String(row.Exchange || '').trim()
  };
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
      difficulty: +await d.text(),
      blockReward: +await r.text(),
      hashRate: (await s.json()).hash_rate / 1e9 // EH/s
    };
  } catch (e) {
    console.error('Blockchain metrics fallback', e);
    return { blockHeight: 514714, difficulty: 110.57e12, blockReward: 3.521, hashRate: 200 };
  }
}

/* ───────────────────────────── Helpers */
function buildCostBasisTimeline(purchases) {
  const sorted = [...purchases].sort(
    (a, b) => parseTimestamp(a.timestamp) - parseTimestamp(b.timestamp)
  );
  let btc = 0, cost = 0;
  return sorted.map(p => {
    btc += p.quantity;
    cost += p.totalCost;
    return {
      timestamp: parseTimestamp(p.timestamp),
      costBasis: btc ? cost / btc : 0,
      totalBtc: btc
    };
  });
}

function buildGainSeries(costTimeline, hist) {
  return hist
    .map(row => {
      const ts = parseHistoricalDate(row.Date);
      const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
      const last =
        costTimeline.filter(t => t.timestamp <= ts).slice(-1)[0] ||
        { costBasis: 0, totalBtc: 0 };
      const gain = last.totalBtc ? (price - last.costBasis) * last.totalBtc : 0;
      return { x: ts, y: gain };
    })
    .filter(p => !isNaN(p.x) && !isNaN(p.y));
}

function setDateRangeLabels(container, startDate, endDate) {
  container.replaceChildren();
  const startLabel = document.createElement('span');
  startLabel.textContent = startDate.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric'
  });

  const endLabel = document.createElement('span');
  endLabel.textContent = endDate.toLocaleDateString('en-US', {
    month: 'short',
    year: 'numeric'
  });

  container.append(startLabel, endLabel);
}

function setSignedValue(container, text, isPositive) {
  container.replaceChildren();
  const span = document.createElement('span');
  span.className = isPositive ? 'positive' : 'negative';
  span.textContent = text;
  container.appendChild(span);
}

function appendCell(row, value) {
  const td = document.createElement('td');
  td.textContent = value;
  row.appendChild(td);
}

/* ───────────────────────────── Filter */
function filterDataByDateRange(s, e) {
  const within = a => a.filter(pt => pt.x >= s && pt.x <= e);
  const priceData = within(originalPriceData);
  const cbData = within(originalCostBasisData);
  const coinbaseData = within(
    originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase')
  );
  const geminiData = within(
    originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini')
  );
  const venmoData = within(
    originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo')
  );
  const coinbitsData = within(
    originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbits')
  );
  const gainData = within(originalGainData);

  priceChart.data.datasets[0].data = priceData;
  priceChart.data.datasets[1].data = cbData;

  priceChart.data.datasets[2].data = coinbaseData;
  priceChart.data.datasets[2].pointRadius = coinbaseData.map(p => p.radius);
  priceChart.data.datasets[2].pointHoverRadius = coinbaseData.map(p => p.hoverRadius);

  priceChart.data.datasets[3].data = geminiData;
  priceChart.data.datasets[3].pointRadius = geminiData.map(p => p.radius);
  priceChart.data.datasets[3].pointHoverRadius = geminiData.map(p => p.hoverRadius);

  priceChart.data.datasets[4].data = venmoData;
  priceChart.data.datasets[4].pointRadius = venmoData.map(p => p.radius);
  priceChart.data.datasets[4].pointHoverRadius = venmoData.map(p => p.hoverRadius);

  priceChart.data.datasets[5].data = coinbitsData;
  priceChart.data.datasets[5].pointRadius = coinbitsData.map(p => p.radius);
  priceChart.data.datasets[5].pointHoverRadius = coinbitsData.map(p => p.hoverRadius);

  priceChart.data.datasets[6].data = gainData;

  priceChart.update();
}

/* ───────────────────────────── Slider */
function initializeSlider(minDate, maxDate) {
  const slider = document.getElementById('date-range-slider');
  const labels = document.getElementById('date-range-labels');
  let tries = 0, maxRetries = 10;
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
        setDateRangeLabels(labels, s, e);
        filterDataByDateRange(s, e);
      });
      setDateRangeLabels(labels, minDate, maxDate);
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
    // Load CSVs
    const [transactions, historic] = await Promise.all([
      fetchCSV('transactions.csv'),
      fetchCSV('historical_btc_prices.csv')
    ]);
    const transactionRows = transactions.map(normalizeTransactionRow).filter(r => r.Timestamp);

    // Metrics
    const btcMetrics = await getBtcMetrics();
    const blockchainMetrics = await getBlockchainMetrics();
    const currentPrice = btcMetrics.currentPrice;

    // Purchases
    const purchases = transactionRows
      .map(r => {
        const quantity = +String(r['Quantity Transacted'] || '').replace(/[^0-9.-]/g, '');
        const totalRaw = parseUsd(r.Total);
        const subtotalRaw = parseUsd(r.Subtotal);
        const notional = totalRaw > 0 ? totalRaw : subtotalRaw;

        return {
          timestamp: r.Timestamp,
          quantity,
          totalCost: notional,
          priceAtTransaction: parseUsd(r['Price at Transaction']),
          exchange: r.Exchange
        };
      })
      .filter(
        p =>
          !isNaN(p.quantity) &&
          !isNaN(p.totalCost) &&
          !isNaN(p.priceAtTransaction) &&
          p.exchange
      );

    // Portfolio math
    const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
    const invested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
    const costBasis = totalBtc ? invested / totalBtc : 0;
    const currentVal = totalBtc * currentPrice;
    const gainLoss = currentVal - invested;
    const gainPct = invested ? (gainLoss / invested) * 100 : 0;

    // ── Split tile: "To 1 BTC"
    const btcRemaining = Math.max(1 - totalBtc, 0);
    const costToOne = btcRemaining * currentPrice;

    // DOM update
    const $ = id => document.getElementById(id);

    // Split tile values
    $('btc-to-one').innerText = btcRemaining.toFixed(8) + ' BTC';
    $('usd-to-one').innerText = formatUsd(costToOne);

    // Summary tiles
    $('total-btc').innerText = totalBtc.toFixed(8);
    $('invested').innerText = formatUsd(invested);
    $('cost-basis').innerText = formatUsd(costBasis);
    $('current-value').innerText = formatUsd(currentVal);
    setSignedValue(
      $('gain-loss'),
      `${gainLoss >= 0 ? '+' : ''}${formatUsd(gainLoss)} (${gainPct.toFixed(2)}%)`,
      gainLoss >= 0
    );

    // BTC market tiles
    $('btc-price').innerText = formatUsd(currentPrice);
    $('btc-market-cap').innerText = formatUsd(btcMetrics.marketCap);
    $('btc-volume').innerText = formatUsd(btcMetrics.volume24h);
    setSignedValue(
      $('btc-price-change'),
      `${btcMetrics.priceChange24h >= 0 ? '+' : ''}${btcMetrics.priceChange24h.toFixed(2)}%`,
      btcMetrics.priceChange24h >= 0
    );

    // Chain tiles
    $('btc-block-height').innerText = blockchainMetrics.blockHeight.toLocaleString();
    $('btc-difficulty').innerText = (blockchainMetrics.difficulty / 1e12).toFixed(2) + ' T';
    $('btc-hash-rate').innerText = blockchainMetrics.hashRate.toFixed(2) + ' EH/s';
    $('btc-block-reward').innerText = blockchainMetrics.blockReward.toFixed(3) + ' BTC';

    // Transaction table
    const tableBody = document.getElementById('transactions-body');
    if (tableBody) {
      tableBody.replaceChildren();
      purchases
        .sort((a, b) => parseTimestamp(b.timestamp) - parseTimestamp(a.timestamp))
        .forEach(p => {
          const tr = document.createElement('tr');
          appendCell(tr, parseTimestamp(p.timestamp).toLocaleDateString());
          appendCell(tr, p.quantity.toFixed(8));
          appendCell(tr, formatUsd(p.totalCost));
          appendCell(tr, formatUsd(p.priceAtTransaction));
          appendCell(tr, p.exchange);
          tableBody.appendChild(tr);
        });
    }

    // Build data arrays
    originalPriceData = historic
      .map(r => {
        const ts = parseHistoricalDate(r.Date);
        const y = +((r.Price || '').replace(/[^0-9.]/g, ''));
        return { x: ts, y };
      })
      .filter(pt => !isNaN(pt.x) && !isNaN(pt.y));

    const maxQty = Math.max(...purchases.map(p => p.quantity), 0);
    originalPurchaseData = purchases.map(p => {
      const ts = parseTimestamp(p.timestamp);
      const frac = maxQty ? Math.log1p(p.quantity / maxQty) / Math.log1p(1) : 0;
      const rMin = 4, rMax = 20;
      return {
        x: ts,
        y: p.priceAtTransaction,
        quantity: p.quantity,
        cost: p.totalCost,
        radius: rMin + frac * (rMax - rMin),
        hoverRadius: rMin + frac * (rMax - rMin) + 2,
        exchange: p.exchange
      };
    });

    const costTimeline = buildCostBasisTimeline(purchases);
    originalCostBasisData = originalPriceData.map(pt => {
      const last = costTimeline.filter(t => t.timestamp <= pt.x).slice(-1)[0] || { costBasis: 0 };
      return { x: pt.x, y: last.costBasis };
    });

    originalGainData = buildGainSeries(costTimeline, historic);
    const y1Max = Math.max(0, ...originalGainData.map(d => d.y)) * 1.5 || 1;

    // Create / refresh chart
    if (priceChart) priceChart.destroy();
    const ctx = document.getElementById('priceChart').getContext('2d');
    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          /* 0: BTC Price */
          {
            label: 'BTC Price (USD)',
            data: originalPriceData,
            borderColor: '#fff',
            backgroundColor: 'rgba(255,255,255,0.03)',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            yAxisID: 'y',
            order: 1
          },
          /* 1: Cost Basis */
          {
            label: 'Cost Basis (USD)',
            data: originalCostBasisData,
            borderColor: '#FFA500',
            backgroundColor: 'rgba(255,165,0,0.08)',
            borderDash: [6, 4],
            fill: false,
            tension: 0,
            pointRadius: 0,
            yAxisID: 'y',
            order: 1
          },
          /* 2: Coinbase Purchases */
          {
            label: 'Coinbase Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase'),
            backgroundColor: '#1E90FF',
            borderColor: '#000',
            borderWidth: 1,
            pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase').map(p => p.radius),
            pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase').map(p => p.hoverRadius),
            yAxisID: 'y',
            order: 0
          },
          /* 3: Gemini Purchases */
          {
            label: 'Gemini Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini'),
            backgroundColor: '#800080',
            borderColor: '#000',
            borderWidth: 1,
            pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini').map(p => p.radius),
            pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini').map(p => p.hoverRadius),
            yAxisID: 'y',
            order: 0
          },
          /* 4: Venmo Purchases */
          {
            label: 'Venmo Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo'),
            backgroundColor: '#00FF00',
            borderColor: '#000',
            borderWidth: 1,
            pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo').map(p => p.radius),
            pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo').map(p => p.hoverRadius),
            yAxisID: 'y',
            order: 0
          },
          /* 5: Coinbits Purchases */
          {
            label: 'Coinbits Purchases',
            type: 'scatter',
            data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbits'),
            backgroundColor: '#FFD700',
            borderColor: '#000',
            borderWidth: 1,
            pointRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbits').map(p => p.radius),
            pointHoverRadius: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbits').map(p => p.hoverRadius),
            yAxisID: 'y',
            order: 0
          },
          /* 6: Cumulative Gain */
          {
            label: 'Cumulative Gain (USD)',
            data: originalGainData,
            borderColor: '#39FF14',
            backgroundColor: 'rgba(57,255,20,0.1)',
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
        scales: {
          x: {
            type: 'time',
            time: { unit: 'month', displayFormats: { month: 'MMM yy' } },
            title: { display: true, text: 'Date', color: '#fff', font: { size: 14 } },
            grid: { color: '#444' },
            ticks: { color: '#fff' },
            min: '2022-01-01'
          },
          y: {
            title: { display: true, text: 'Price (USD)', color: '#fff', font: { size: 14 } },
            grid: { color: '#444' },
            ticks: { color: '#fff', callback: v => v.toLocaleString() },
            suggestedMax: 150000,
            suggestedMin: 0
          },
          y1: {
            position: 'right',
            title: { display: true, text: 'Cumulative Gain (USD)', color: '#fff', font: { size: 14 } },
            grid: { drawOnChartArea: false },
            ticks: { color: '#fff', callback: v => v.toLocaleString() },
            suggestedMax: y1Max,
            suggestedMin: 0
          }
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
                if (['Coinbase Purchases','Gemini Purchases','Venmo Purchases','Coinbits Purchases'].includes(lbl)) {
                  const p = ctx.raw;
                  return `${lbl}: Bought ${p.quantity.toFixed(8)} BTC for ${p.cost.toLocaleString('en-US',{style:'currency',currency:'USD'})}`;
                }
                if (lbl === 'Cumulative Gain (USD)') return `Gain: ${ctx.parsed.y.toLocaleString()}`;
                if (lbl === 'Cost Basis (USD)') return `Cost Basis: ${ctx.parsed.y.toLocaleString('en-US',{style:'currency',currency:'USD'})}`;
                return `Price: ${ctx.parsed.y.toLocaleString()}`;
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

    // Initialize range slider
    //initializeSlider(
      //new Date('2022-01-01'),
     // new Date(new Date().setDate(new Date().getDate() + 60))
    //);

  } catch (e) {
    console.error(e);
    document.getElementById('chart-error').innerText = `Error: ${e.message}`;
  }
}

// On load
const refreshButton = document.getElementById('refresh-button');
if (refreshButton) {
  refreshButton.addEventListener('click', updateTracker);
}
updateTracker();
