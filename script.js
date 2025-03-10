let priceChart = null;
let originalPriceData = [];
let originalPurchaseData = [];
let originalGainData = [];

// Fetch and parse CSV data with enhanced error handling
async function fetchCSV(url) {
    const response = await fetch(url + '?cache=' + Date.now());
    if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`);
    const text = await response.text();
    return new Promise((resolve, reject) => {
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            complete: result => {
                const data = result.data.map(row => {
                    Object.keys(row).forEach(key => {
                        row[key] = row[key].trim(); // Trim whitespace
                    });
                    return row;
                }).filter(row => Object.values(row).some(val => val)); // Remove empty rows
                resolve(data);
            },
            error: error => reject(error)
        });
    });
}

// Fetch BTC metrics with fallback
async function getBtcMetrics() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Failed to fetch BTC metrics: ${response.status}`);
        const data = await response.json();
        if (!data || data.length === 0) throw new Error('Invalid BTC metrics received');
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

// Fetch blockchain metrics with fallback
async function getBlockchainMetrics() {
    try {
        const [heightRes, difficultyRes, rewardRes] = await Promise.all([
            fetch('https://blockchain.info/q/getblockcount', { cache: 'no-store' }),
            fetch('https://blockchain.info/q/getdifficulty', { cache: 'no-store' }),
            fetch('https://blockchain.info/q/bcperblock', { cache: 'no-store' })
        ]);
        if (!heightRes.ok || !difficultyRes.ok || !rewardRes.ok) {
            throw new Error('Failed to fetch blockchain metrics');
        }
        const blockHeight = await heightRes.text();
        const difficulty = await difficultyRes.text();
        const rewardSatoshi = await rewardRes.text();
        return {
            blockHeight: parseInt(blockHeight),
            difficulty: parseFloat(difficulty),
            blockReward: parseInt(rewardSatoshi) / 100000000
        };
    } catch (error) {
        console.error('Error fetching blockchain metrics:', error);
        return { blockHeight: 885419, difficulty: 110.57e12, blockReward: 3.125 };
    }
}

// Calculate cumulative gain with standardized date parsing
function calculateGainData(purchases, historicalPrices) {
    const sortedPurchases = [...purchases].sort((a, b) => {
        const dateA = new Date(a.timestamp.replace(' ', 'T') + 'Z');
        const dateB = new Date(b.timestamp.replace(' ', 'T') + 'Z');
        return dateA - dateB;
    });
    let cumulativeBtc = 0;
    let cumulativeCost = 0;
    const costBasisOverTime = sortedPurchases.map(p => {
        cumulativeBtc += p.quantity;
        cumulativeCost += p.totalCost;
        const costBasis = cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0;
        const timestamp = new Date(p.timestamp.replace(' ', 'T') + 'Z');
        if (isNaN(timestamp.getTime())) {
            console.error('Invalid purchase timestamp:', p.timestamp);
        }
        return { timestamp, costBasis, totalBtc: cumulativeBtc };
    });

    const gainData = historicalPrices.map(row => {
        const timestamp = new Date(row.Date + 'T00:00:00Z');
        if (isNaN(timestamp.getTime())) {
            console.error('Invalid historical price date:', row.Date);
            return null;
        }
        const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, '')) || 0;
        const relevantPurchase = costBasisOverTime.filter(p => p.timestamp <= timestamp).slice(-1)[0] || { costBasis: 0, totalBtc: 0 };
        const gain = relevantPurchase.totalBtc > 0 ? (price - relevantPurchase.costBasis) * relevantPurchase.totalBtc : 0;
        return { x: timestamp, y: gain };
    }).filter(point => point !== null && !isNaN(point.x.getTime()) && !isNaN(point.y));

    return gainData;
}

// Filter data by date range
function filterDataByDateRange(startDate, endDate) {
    const filteredPriceData = originalPriceData.filter(point => point.x >= startDate && point.x <= endDate);
    const filteredCoinbaseData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate && point.exchange.toLowerCase() === 'coinbase');
    const filteredGeminiData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate && point.exchange.toLowerCase() === 'gemini');
    const filteredVenmoData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate && point.exchange.toLowerCase() === 'venmo');
    const filteredGainData = originalGainData.filter(point => point.x >= startDate && point.x <= endDate);

    if (priceChart) {
        priceChart.data.datasets[0].data = filteredPriceData;
        priceChart.data.datasets[1].data = filteredCoinbaseData;
        priceChart.data.datasets[1].pointRadius = filteredCoinbaseData.map(p => p.radius || 4);
        priceChart.data.datasets[1].pointHoverRadius = filteredCoinbaseData.map(p => p.hoverRadius || 6);
        priceChart.data.datasets[2].data = filteredGeminiData;
        priceChart.data.datasets[2].pointRadius = filteredGeminiData.map(p => p.radius || 4);
        priceChart.data.datasets[2].pointHoverRadius = filteredGeminiData.map(p => p.hoverRadius || 6);
        priceChart.data.datasets[3].data = filteredVenmoData;
        priceChart.data.datasets[3].pointRadius = filteredVenmoData.map(p => p.radius || 4);
        priceChart.data.datasets[3].pointHoverRadius = filteredVenmoData.map(p => p.hoverRadius || 6);
        priceChart.data.datasets[4].data = filteredGainData;
        priceChart.update();
    }
}

// Initialize slider with retry logic
function initializeSlider(minDate, maxDate) {
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');
    const maxRetries = 10;
    let retries = 0;

    function tryInitializeSlider() {
        if (typeof noUiSlider !== 'undefined' && noUiSlider.create) {
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
                labels.innerHTML = `
                    <span>${startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                    <span>${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                `;
                filterDataByDateRange(startDate, endDate);
            });

            labels.innerHTML = `
                <span>${minDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                <span>${maxDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            `;
        } else if (retries < maxRetries) {
            retries++;
            console.log(`Retrying slider initialization (${retries}/${maxRetries})...`);
            setTimeout(tryInitializeSlider, 500);
        } else {
            console.error('Failed to load noUiSlider after maximum retries.');
            document.getElementById('chart-error').innerText = 'Error: Date range slider not available.';
            slider.style.display = 'none';
            labels.style.display = 'none';
        }
    }

    tryInitializeSlider();
}

// Main update function
async function updateTracker() {
    try {
        const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
        const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
        const btcMetrics = await getBtcMetrics();
        const blockchainMetrics = await getBlockchainMetrics();
        const currentPrice = btcMetrics.currentPrice;

        const purchases = transactions.map((p, index) => {
            console.log(`Transaction Row ${index}:`, p);
            const totalCostStr = (p["Total (inclusive of fees and/or spread)"] || '').replace(/[^0-9.]/g, '');
            const priceAtTransactionStr = (p["Price at Transaction"] || '').replace(/[^0-9.]/g, '');
            return {
                timestamp: p.Timestamp,
                quantity: parseFloat(p["Quantity Transacted"]) || 0,
                totalCost: parseFloat(totalCostStr) || 0,
                priceAtTransaction: parseFloat(priceAtTransactionStr) || 0,
                exchange: p.Exchange || 'Unknown'
            };
        }).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction) && p.exchange);

        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        const maxBtcQuantity = Math.max(...purchases.map(p => p.quantity)) || 1; // Avoid division by zero
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalBtc > 0 ? totalInvested / totalBtc : 0;
        const currentValue = totalBtc * currentPrice;
        const gainLoss = currentValue - totalInvested;
        const gainLossPercent = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

        // Update DOM elements
        document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
        document.getElementById('invested').innerText = totalInvested.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('cost-basis').innerText = costBasis.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('current-value').innerText = currentValue.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('gain-loss').innerHTML = `
            <span class="${gainLoss >= 0 ? 'positive' : 'negative'}">
                ${gainLoss >= 0 ? '+' : ''}${gainLoss.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
                <span class="percentage">(${gainLossPercent.toFixed(2)}%)</span>
            </span>
        `;
        document.getElementById('btc-price').innerText = currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-market-cap').innerText = btcMetrics.marketCap.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-volume').innerText = btcMetrics.volume24h.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-price-change').innerHTML = `
            <span class="${btcMetrics.priceChange24h >= 0 ? 'positive' : 'negative'}">
                ${btcMetrics.priceChange24h >= 0 ? '+' : ''}${btcMetrics.priceChange24h.toFixed(2)}%
            </span>
        `;
        document.getElementById('btc-block-height').innerText = blockchainMetrics.blockHeight.toLocaleString();
        document.getElementById('btc-difficulty').innerText = (blockchainMetrics.difficulty / 1e12).toFixed(2) + ' T';
        document.getElementById('btc-block-reward').innerText = blockchainMetrics.blockReward.toFixed(3) + ' BTC';

        const tableBody = document.getElementById('transactions-body');
        tableBody.innerHTML = purchases.map(p => `
            <tr>
                <td>${p.timestamp}</td>
                <td>${p.quantity.toFixed(8)}</td>
                <td>${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
                <td>${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
                <td>${p.exchange}</td>
            </tr>
        `).join('');

        // Parse historical price data as UTC
        originalPriceData = historicalPrices.map(row => {
            const dateStr = row.Date + 'T00:00:00Z'; // Assume YYYY-MM-DD, force UTC
            const timestamp = new Date(dateStr);
            if (isNaN(timestamp.getTime())) {
                console.error('Invalid historical price date:', row.Date);
                return null;
            }
            const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, '')) || 0;
            return { x: timestamp, y: price };
        }).filter(point => point !== null && !isNaN(point.x.getTime()) && !isNaN(point.y));

        // Parse purchase data as UTC
        originalPurchaseData = purchases.map(p => {
            const dateStr = p.timestamp.replace(' ', 'T') + 'Z'; // Convert YYYY-MM-DD HH:MM:SS to ISO UTC
            const timestamp = new Date(dateStr);
            if (isNaN(timestamp.getTime())) {
                console.error('Invalid purchase timestamp:', p.timestamp);
                return null;
            }
            const btcRatio = maxBtcQuantity > 0 ? p.quantity / maxBtcQuantity : 0;
            const btcFraction = btcRatio > 0 ? Math.log1p(btcRatio) / Math.log1p(1) : 0;
            const minRadius = 4;
            const maxRadius = 20;
            const radius = minRadius + btcFraction * (maxRadius - minRadius);
            const hoverRadius = radius + 2;
            return {
                x: timestamp,
                y: p.priceAtTransaction,
                quantity: p.quantity,
                cost: p.totalCost,
                radius: radius,
                hoverRadius: hoverRadius,
                exchange: p.exchange
            };
        }).filter(point => point !== null && !isNaN(point.x.getTime()) && !isNaN(point.y));

        const coinbasePurchases = originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'coinbase');
        const geminiPurchases = originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'gemini');
        const venmoPurchases = originalPurchaseData.filter(p => p.exchange.toLowerCase() === 'venmo');

        originalGainData = calculateGainData(purchases, historicalPrices);

        console.log('Historical Price Data:', originalPriceData);
        console.log('Coinbase Purchase Data:', coinbasePurchases);
        console.log('Gemini Purchase Data:', geminiPurchases);
        console.log('Venmo Purchase Data:', venmoPurchases);
        console.log('Gain Data:', originalGainData);

        if (originalPriceData.length === 0 || originalPurchaseData.length === 0) {
            document.getElementById('chart-error').innerText = 'Error: No valid data available to plot.';
            return;
        }

        const ctx = document.getElementById('priceChart').getContext('2d');
        if (priceChart) priceChart.destroy();
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'BTC Price (USD)',
                        data: originalPriceData,
                        borderColor: '#ffffff',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y',
                        order: 1
                    },
                    {
                        label: 'Coinbase Purchases',
                        data: coinbasePurchases,
                        type: 'scatter',
                        backgroundColor: '#1E90FF',
                        pointRadius: coinbasePurchases.map(p => p.radius || 4),
                        pointHoverRadius: coinbasePurchases.map(p => p.hoverRadius || 6),
                        borderColor: '#000000',
                        borderWidth: 1,
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        label: 'Gemini Purchases',
                        data: geminiPurchases,
                        type: 'scatter',
                        backgroundColor: '#800080',
                        pointRadius: geminiPurchases.map(p => p.radius || 4),
                        pointHoverRadius: geminiPurchases.map(p => p.hoverRadius || 6),
                        borderColor: '#000000',
                        borderWidth: 1,
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        label: 'Venmo Purchases',
                        data: venmoPurchases,
                        type: 'scatter',
                        backgroundColor: '#00FF00',
                        pointRadius: venmoPurchases.map(p => p.radius || 4),
                        pointHoverRadius: venmoPurchases.map(p => p.hoverRadius || 6),
                        borderColor: '#000000',
                        borderWidth: 1,
                        yAxisID: 'y',
                        order: 0
                    },
                    {
                        label: 'Cumulative Gain (USD)',
                        data: originalGainData,
                        borderColor: '#39FF14',
                        backgroundColor: 'rgba(57, 255, 20, 0.1)',
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
                maintainAspectRatio: false, // Improve rendering in Safari
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            displayFormats: { month: 'MMM yyyy' },
                            timezone: 'UTC' // Ensure UTC display
                        },
                        title: { display: true, text: 'Date', color: '#ffffff', font: { size: 14 } },
                        grid: { color: '#444' },
                        ticks: { color: '#ffffff', source: 'auto' }
                    },
                    y: {
                        title: { display: true, text: 'Price (USD)', color: '#ffffff', font: { size: 14 } },
                        grid: { color: '#444' },
                        ticks: { color: '#ffffff', callback: value => `${value.toLocaleString()}` }
                    },
                    y1: {
                        position: 'right',
                        title: { display: true, text: 'Cumulative Gain (USD)', color: '#ffffff', font: { size: 14 } },
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#ffffff', callback: value => `${value.toLocaleString()}` },
                        suggestedMax: 75000,
                        suggestedMin: -500
                    }
                },
                plugins: {
                    legend: { labels: { color: '#ffffff', font: { size: 12 } } },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        callbacks: {
                            label: ctx => {
                                if (ctx.dataset.label.includes('Purchases')) {
                                    const purchases = ctx.dataset.label === 'Coinbase Purchases' ? coinbasePurchases :
                                                     ctx.dataset.label === 'Gemini Purchases' ? geminiPurchases : venmoPurchases;
                                    const p = purchases[ctx.dataIndex];
                                    return `${ctx.dataset.label}: Bought ${p.quantity.toFixed(8)} BTC for ${p.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
                                } else if (ctx.dataset.label === 'Cumulative Gain (USD)') {
                                    return `Gain: ${ctx.parsed.y.toLocaleString()}`;
                                }
                                return `Price: ${ctx.parsed.y.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });

        const minDate = new Date(Math.min(...originalPriceData.map(d => d.x.getTime())));
        const maxDate = new Date(Math.max(...originalPriceData.map(d => d.x.getTime())));
        initializeSlider(minDate, maxDate);
    } catch (error) {
        console.error('Error in updateTracker:', error);
        document.getElementById('chart-error').innerText = `Error: ${error.message}`;
    }
}

// Run on load with a slight delay to ensure DOM readiness
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(updateTracker, 100);
});
