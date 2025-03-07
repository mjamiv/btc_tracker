let priceChart = null;
let originalPriceData = [];
let originalPurchaseData = [];
let originalGainData = [];
let isChartExpanded = false;

async function fetchCSV(url) {
    const response = await fetch(url + '?cache=' + Date.now());
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    const text = await response.text();
    return new Promise(resolve => {
        Papa.parse(text, { header: true, complete: result => resolve(result.data) });
    });
}

async function getBtcMetrics() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin');
        if (!response.ok) throw new Error(`Failed to fetch BTC metrics`);
        const data = await response.json();
        const btcData = data[0];
        return {
            currentPrice: btcData.current_price,
            marketCap: btcData.market_cap,
            volume24h: btcData.total_volume,
            priceChange24h: btcData.price_change_percentage_24h
        };
    } catch (error) {
        console.error('Error fetching BTC metrics:', error);
        return { currentPrice: 93162.00, marketCap: 0, volume24h: 0, priceChange24h: 0 };
    }
}

function calculateGainData(purchases, historicalPrices) {
    const sortedPurchases = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let cumulativeBtc = 0, cumulativeCost = 0;
    const costBasisOverTime = sortedPurchases.map(p => {
        cumulativeBtc += p.quantity;
        cumulativeCost += p.totalCost;
        return { timestamp: new Date(p.timestamp + ' UTC'), costBasis: cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0, totalBtc: cumulativeBtc };
    });
    return historicalPrices.map(row => {
        const timestamp = new Date(row.Date);
        const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
        const relevantPurchase = costBasisOverTime.filter(p => p.timestamp <= timestamp).slice(-1)[0] || { costBasis: 0, totalBtc: 0 };
        const gain = relevantPurchase.totalBtc > 0 ? (price - relevantPurchase.costBasis) * relevantPurchase.totalBtc : 0;
        return { x: timestamp, y: gain };
    }).filter(point => !isNaN(point.x) && !isNaN(point.y));
}

function filterDataByDateRange(startDate, endDate) {
    const filteredPriceData = originalPriceData.filter(point => point.x >= startDate && point.x <= endDate);
    const filteredPurchaseData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate);
    const filteredGainData = originalGainData.filter(point => point.x >= startDate && point.x <= endDate);
    priceChart.data.datasets[0].data = filteredPriceData;
    priceChart.data.datasets[1].data = filteredPurchaseData;
    priceChart.data.datasets[1].pointRadius = filteredPurchaseData.map(p => p.radius);
    priceChart.data.datasets[1].pointHoverRadius = filteredPurchaseData.map(p => p.hoverRadius);
    priceChart.data.datasets[2].data = filteredGainData;
    priceChart.update();
}

function initializeSlider(minDate, maxDate) {
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');
    if (typeof noUiSlider !== 'undefined' && isChartExpanded) {
        noUiSlider.create(slider, {
            start: [minDate.getTime(), maxDate.getTime()],
            connect: true,
            range: { 'min': minDate.getTime(), 'max': maxDate.getTime() },
            step: 24 * 60 * 60 * 1000,
            behaviour: 'drag'
        });
        slider.noUiSlider.on('update', (values) => {
            const startDate = new Date(parseInt(values[0]));
            const endDate = new Date(parseInt(values[1]));
            labels.innerHTML = `<span>${startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span><span>${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
            filterDataByDateRange(startDate, endDate);
        });
        labels.innerHTML = `<span>${minDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span><span>${maxDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>`;
    }
}

async function updateTracker() {
    try {
        const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
        const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
        const btcMetrics = await getBtcMetrics();
        const currentPrice = btcMetrics.currentPrice;

        const purchases = transactions.map(p => ({
            timestamp: p.Timestamp,
            quantity: parseFloat(p["Quantity Transacted"]),
            totalCost: parseFloat((p["Total (inclusive of fees and/or spread)"] || '').replace(/[^0-9.]/g, '')),
            priceAtTransaction: parseFloat((p["Price at Transaction"] || '').replace(/[^0-9.]/g, ''))
        })).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction));

        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        const maxBtcQuantity = Math.max(...purchases.map(p => p.quantity));
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalBtc > 0 ? totalInvested / totalBtc : 0;
        const currentValue = totalBtc * currentPrice;
        const gainLoss = currentValue - totalInvested;
        const gainLossPercent = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

        document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
        document.getElementById('invested').innerText = totalInvested.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        document.getElementById('cost-basis').innerText = costBasis.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        document.getElementById('current-value').innerText = currentValue.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        document.getElementById('gain-loss').innerHTML = `<span class="${gainLoss >= 0 ? 'positive' : 'negative'}">${gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} (${gainLossPercent.toFixed(1)}%)</span>`;
        document.getElementById('btc-price').innerText = currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        document.getElementById('btc-market-cap').innerText = btcMetrics.marketCap.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        document.getElementById('btc-volume').innerText = btcMetrics.volume24h.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
        document.getElementById('btc-price-change').innerHTML = `<span class="${btcMetrics.priceChange24h >= 0 ? 'positive' : 'negative'}">${btcMetrics.priceChange24h >= 0 ? '+' : ''}${btcMetrics.priceChange24h.toFixed(2)}%</span>`;

        const recentPurchases = purchases.slice(-3).reverse();
        document.getElementById('transactions-body').innerHTML = recentPurchases.map(p => `
            <tr><td>${p.timestamp}</td><td>${p.quantity.toFixed(8)}</td><td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td><td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td></tr>
        `).join('');
        window.fullPurchases = purchases; // Store full list for expansion

        originalPriceData = historicalPrices.map(row => ({ x: new Date(row.Date), y: parseFloat((row.Price || '').replace(/[^0-9.]/g, '')) })).filter(p => !isNaN(p.x) && !isNaN(p.y));
        originalPurchaseData = purchases.map(p => {
            const btcRatio = maxBtcQuantity > 0 ? p.quantity / maxBtcQuantity : 0;
            const radius = 4 + (Math.log1p(btcRatio) / Math.log1p(1)) * (10 - 4);
            return { x: new Date(p.timestamp + ' UTC'), y: p.priceAtTransaction, quantity: p.quantity, cost: p.totalCost, radius, hoverRadius: radius + 2 };
        }).filter(p => !isNaN(p.x) && !isNaN(p.y));
        originalGainData = calculateGainData(purchases, historicalPrices);

        const ctx = document.getElementById('priceChart').getContext('2d');
        if (priceChart) priceChart.destroy();
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    { label: 'BTC Price', data: originalPriceData, borderColor: '#ffffff', fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y', order: 1 },
                    { label: 'My Purchases', data: originalPurchaseData, type: 'scatter', backgroundColor: '#F7931A', pointRadius: originalPurchaseData.map(p => p.radius), pointHoverRadius: originalPurchaseData.map(p => p.hoverRadius), borderColor: '#000000', borderWidth: 1, yAxisID: 'y', order: 0 },
                    { label: 'Cumulative Gain', data: originalGainData, borderColor: '#39FF14', fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1', order: 2 }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    x: { type: 'time', time: { unit: 'month', displayFormats: { month: 'MMM yyyy' } }, title: { display: true, text: 'Date', color: '#ffffff' }, grid: { color: '#444' }, ticks: { color: '#ffffff' } },
                    y: { title: { display: true, text: 'Price (USD)', color: '#ffffff' }, grid: { color: '#444' }, ticks: { color: '#ffffff', callback: value => `${value.toLocaleString()}` } },
                    y1: { position: 'right', title: { display: true, text: 'Gain (USD)', color: '#ffffff' }, grid: { drawOnChartArea: false }, ticks: { color: '#ffffff', callback: value => `${value.toLocaleString()}` } }
                },
                plugins: {
                    legend: { labels: { color: '#ffffff' } },
                    tooltip: {
                        callbacks: {
                            label: ctx => ctx.dataset.label === 'My Purchases' ? `Bought ${ctx.raw.quantity.toFixed(8)} BTC for ${ctx.raw.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}` : `${ctx.dataset.label}: ${ctx.parsed.y.toLocaleString()}`
                        }
                    }
                }
            }
        });

        if (isChartExpanded) {
            const minDate = new Date(Math.min(...originalPriceData.map(d => d.x)));
            const maxDate = new Date(Math.max(...originalPriceData.map(d => d.x)));
            initializeSlider(minDate, maxDate);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function toggleSection(id) {
    const content = document.getElementById(id);
    content.classList.toggle('expanded');
}

function toggleChartExpansion() {
    const chartContent = document.getElementById('chart-content');
    isChartExpanded = !isChartExpanded;
    chartContent.classList.toggle('expanded');
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');
    slider.style.display = isChartExpanded ? 'block' : 'none';
    labels.style.display = isChartExpanded ? 'flex' : 'none';
    if (isChartExpanded) {
        const minDate = new Date(Math.min(...originalPriceData.map(d => d.x)));
        const maxDate = new Date(Math.max(...originalPriceData.map(d => d.x)));
        initializeSlider(minDate, maxDate);
    }
    priceChart.resize();
}

function toggleTableExpansion() {
    const tableContent = document.getElementById('table-content');
    tableContent.classList.toggle('expanded');
    const tbody = document.getElementById('transactions-body');
    if (tableContent.classList.contains('expanded')) {
        tbody.innerHTML = window.fullPurchases.map(p => `
            <tr><td>${p.timestamp}</td><td>${p.quantity.toFixed(8)}</td><td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td><td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td></tr>
        `).join('');
    } else {
        const recentPurchases = window.fullPurchases.slice(-3).reverse();
        tbody.innerHTML = recentPurchases.map(p => `
            <tr><td>${p.timestamp}</td><td>${p.quantity.toFixed(8)}</td><td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td><td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}</td></tr>
        `).join('');
    }
}

updateTracker();
