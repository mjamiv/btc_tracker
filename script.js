let priceChart = null;
let originalPriceData = [];
let originalPurchaseData = [];
let originalGainData = [];

async function fetchCSV(url) {
    try {
        const response = await fetch(url + '?cache=' + Date.now());
        if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
        const text = await response.text();
        return new Promise(resolve => {
            Papa.parse(text, {
                header: true,
                skipEmptyLines: true,
                complete: result => resolve(result.data.filter(row => Object.values(row).some(val => val)))
            });
        });
    } catch (error) {
        console.error('CSV fetch error:', error);
        throw error;
    }
}

async function getBtcMetrics() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin');
        if (!response.ok) throw new Error(`Failed to fetch BTC metrics: ${response.status}`);
        const [btcData] = await response.json();
        if (!btcData) throw new Error('No BTC data received');
        return {
            currentPrice: btcData.current_price,
            marketCap: btcData.market_cap,
            volume24h: btcData.total_volume,
            priceChange24h: btcData.price_change_percentage_24h
        };
    } catch (error) {
        console.error('BTC metrics error:', error);
        return { currentPrice: 93162.00, marketCap: 0, volume24h: 0, priceChange24h: 0 };
    }
}

async function getBlockchainMetrics() {
    try {
        const [heightRes, difficultyRes, rewardRes] = await Promise.all([
            fetch('https://blockchain.info/q/getblockcount'),
            fetch('https://blockchain.info/q/getdifficulty'),
            fetch('https://blockchain.info/q/bcperblock')
        ]);
        if (!heightRes.ok || !difficultyRes.ok || !rewardRes.ok) throw new Error('Blockchain API error');
        return {
            blockHeight: parseInt(await heightRes.text()),
            difficulty: parseFloat(await difficultyRes.text()),
            blockReward: parseInt(await rewardRes.text()) / 100000000
        };
    } catch (error) {
        console.error('Blockchain metrics error:', error);
        return { blockHeight: 885419, difficulty: 110.57e12, blockReward: 3.125 };
    }
}

function calculateGainData(purchases, historicalPrices) {
    const sortedPurchases = [...purchases].sort((a, b) => a.timestamp - b.timestamp);
    let cumulativeBtc = 0, cumulativeCost = 0;
    const costBasisOverTime = sortedPurchases.map(p => {
        cumulativeBtc += p.quantity;
        cumulativeCost += p.totalCost;
        return { timestamp: p.timestamp, costBasis: cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0, totalBtc: cumulativeBtc };
    });

    return historicalPrices.map(row => {
        const price = row.y;
        const relevantPurchase = costBasisOverTime.filter(p => p.timestamp <= row.x).slice(-1)[0] || { costBasis: 0, totalBtc: 0 };
        const gain = relevantPurchase.totalBtc > 0 ? (price - relevantPurchase.costBasis) * relevantPurchase.totalBtc : 0;
        return { x: row.x, y: gain };
    }).filter(point => point.x && !isNaN(point.y));
}

function filterDataByDateRange(startDate, endDate) {
    if (!priceChart) return;
    const filteredPriceData = originalPriceData.filter(p => p.x >= startDate && p.x <= endDate);
    const filteredPurchases = originalPurchaseData.filter(p => p.x >= startDate && p.x <= endDate);
    const filteredGainData = originalGainData.filter(p => p.x >= startDate && p.x <= endDate);

    priceChart.data.datasets[0].data = filteredPriceData;
    priceChart.data.datasets[1].data = filteredPurchases.filter(p => p.exchange.toLowerCase() === 'coinbase');
    priceChart.data.datasets[2].data = filteredPurchases.filter(p => p.exchange.toLowerCase() === 'gemini');
    priceChart.data.datasets[3].data = filteredPurchases.filter(p => p.exchange.toLowerCase() === 'venmo');
    priceChart.data.datasets[4].data = filteredGainData;
    priceChart.update();
}

function initializeSlider(minDate, maxDate) {
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');
    if (typeof noUiSlider === 'undefined') {
        console.error('noUiSlider not loaded');
        document.getElementById('chart-error').innerText = 'Date slider unavailable';
        return;
    }
    noUiSlider.create(slider, {
        start: [minDate.getTime(), maxDate.getTime()],
        connect: true,
        range: { 'min': minDate.getTime(), 'max': maxDate.getTime() },
        step: 24 * 60 * 60 * 1000,
        behaviour: 'drag'
    });
    slider.noUiSlider.on('update', values => {
        const [start, end] = values.map(v => new Date(parseInt(v)));
        labels.innerHTML = `${start.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
        filterDataByDateRange(start, end);
    });
}

async function updateTracker() {
    const chartError = document.getElementById('chart-error');
    chartError.innerText = 'Loading...';
    try {
        const [transactions, historicalPrices, btcMetrics, blockchainMetrics] = await Promise.all([
            fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv'),
            fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv'),
            getBtcMetrics(),
            getBlockchainMetrics()
        ]);

        const purchases = transactions.map(p => {
            const timestamp = new Date(p.Timestamp + ' UTC');
            return {
                timestamp,
                quantity: parseFloat(p["Quantity Transacted"]) || 0,
                totalCost: parseFloat((p["Total (inclusive of fees and/or spread)"] || '').replace(/[^0-9.]/g, '')) || 0,
                priceAtTransaction: parseFloat((p["Price at Transaction"] || '').replace(/[^0-9.]/g, '')) || 0,
                exchange: p.Exchange || 'Unknown'
            };
        }).filter(p => p.timestamp && !isNaN(p.quantity) && !isNaN(p.totalCost));

        if (!purchases.length || !historicalPrices.length) {
            throw new Error('No valid transaction or price data available');
        }

        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        const maxBtcQuantity = Math.max(...purchases.map(p => p.quantity));
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalBtc > 0 ? totalInvested / totalBtc : 0;
        const currentValue = totalBtc * btcMetrics.currentPrice;
        const gainLoss = currentValue - totalInvested;

        document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
        document.getElementById('invested').innerText = totalInvested.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('cost-basis').innerText = costBasis.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('current-value').innerText = currentValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('gain-loss').innerHTML = `<span class="${gainLoss >= 0 ? 'positive' : 'negative'}">${gainLoss.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} (${((gainLoss / totalInvested) * 100).toFixed(2)}%)</span>`;

        document.getElementById('btc-price').innerText = btcMetrics.currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-market-cap').innerText = btcMetrics.marketCap.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-volume').innerText = btcMetrics.volume24h.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-price-change').innerHTML = `<span class="${btcMetrics.priceChange24h >= 0 ? 'positive' : 'negative'}">${btcMetrics.priceChange24h.toFixed(2)}%</span>`;
        document.getElementById('btc-block-height').innerText = blockchainMetrics.blockHeight.toLocaleString();
        document.getElementById('btc-difficulty').innerText = (blockchainMetrics.difficulty / 1e12).toFixed(2) + ' T';
        document.getElementById('btc-block-reward').innerText = blockchainMetrics.blockReward.toFixed(3) + ' BTC';

        document.getElementById('transactions-body').innerHTML = purchases.map(p => `
            <tr><td>${p.timestamp.toLocaleString()}</td><td>${p.quantity.toFixed(8)}</td><td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td><td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td><td>${p.exchange}</td></tr>
        `).join('');

        originalPriceData = historicalPrices.map(row => ({
            x: new Date(row.Date),
            y: parseFloat((row.Price || '').replace(/[^0-9.]/g, '')) || 0
        })).filter(p => p.x && !isNaN(p.y));

        originalPurchaseData = purchases.map(p => {
            const btcRatio = maxBtcQuantity > 0 ? p.quantity / maxBtcQuantity : 0;
            const radius = 4 + (btcRatio * 16);
            return { x: p.timestamp, y: p.priceAtTransaction, quantity: p.quantity, cost: p.totalCost, radius, hoverRadius: radius + 2, exchange: p.exchange };
        });

        originalGainData = calculateGainData(purchases, originalPriceData);

        const ctx = document.getElementById('priceChart').getContext('2d');
        if (!originalPriceData.length || !originalPurchaseData.length) {
            chartError.innerText = 'No valid data to plot';
            return;
        }

        if (priceChart) priceChart.destroy();
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    { label: 'BTC Price (USD)', data: originalPriceData, borderColor: '#ffffff', fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y' },
                    { label: 'Coinbase Purchases', data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase'), type: 'scatter', backgroundColor: '#1E90FF', pointRadius: p => p.radius, pointHoverRadius: p => p.hoverRadius, yAxisID: 'y' },
                    { label: 'Gemini Purchases', data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini'), type: 'scatter', backgroundColor: '#800080', pointRadius: p => p.radius, pointHoverRadius: p => p.hoverRadius, yAxisID: 'y' },
                    { label: 'Venmo Purchases', data: originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo'), type: 'scatter', backgroundColor: '#00FF00', pointRadius: p => p.radius, pointHoverRadius: p => p.hoverRadius, yAxisID: 'y' },
                    { label: 'Cumulative Gain (USD)', data: originalGainData, borderColor: '#39FF14', fill: false, tension: 0.3, pointRadius: 0, yAxisID: 'y1' }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    x: { type: 'time', time: { unit: 'month' }, title: { display: true, text: 'Date', color: '#ffffff' }, grid: { color: '#444' }, ticks: { color: '#ffffff' } },
                    y: { title: { display: true, text: 'Price (USD)', color: '#ffffff' }, grid: { color: '#444' }, ticks: { color: '#ffffff', callback: v => v.toLocaleString() } },
                    y1: { position: 'right', title: { display: true, text: 'Cumulative Gain (USD)', color: '#ffffff' }, grid: { drawOnChartArea: false }, ticks: { color: '#ffffff', callback: v => v.toLocaleString() } }
                },
                plugins: {
                    legend: { labels: { color: '#ffffff' } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const { dataset, dataIndex } = ctx;
                                if (dataset.label.includes('Purchases')) {
                                    const p = dataset.data[dataIndex];
                                    return `${dataset.label}: ${p.quantity.toFixed(8)} BTC for ${p.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
                                }
                                return `${dataset.label}: ${ctx.parsed.y.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });

        const minDate = new Date(Math.min(...originalPriceData.map(d => d.x)));
        const maxDate = new Date(Math.max(...originalPriceData.map(d => d.x)));
        initializeSlider(minDate, maxDate);
        chartError.innerText = '';
    } catch (error) {
        console.error('Update error:', error);
        chartError.innerText = `Error: ${error.message}`;
    }
}

updateTracker();
