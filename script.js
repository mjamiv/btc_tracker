let priceChart = null;
let originalPriceData = [];
let originalPurchaseData = [];
let originalGainData = [];

// Fetch and parse CSV data
async function fetchCSV(url) {
    const response = await fetch(url + '?cache=' + Date.now());
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    const text = await response.text();
    return new Promise(resolve => {
        Papa.parse(text, {
            header: true,
            complete: result => resolve(result.data)
        });
    });
}

// Fetch the current BTC price and metrics from CoinGecko API
async function getBtcMetrics() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin');
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

// Fetch Bitcoin blockchain metrics from Blockchain.com API
async function getBlockchainMetrics() {
    try {
        const [heightRes, difficultyRes, rewardRes, statsRes] = await Promise.all([
            fetch('https://blockchain.info/q/getblockcount'),
            fetch('https://blockchain.info/q/getdifficulty'),
            fetch('https://blockchain.info/q/bcperblock'),
            fetch('https://blockchain.info/stats?format=json') // Added stats endpoint for hash rate
        ]);

        if (!heightRes.ok || !difficultyRes.ok || !rewardRes.ok || !statsRes.ok) {
            throw new Error('Failed to fetch blockchain metrics');
        }

        const blockHeight = await heightRes.text();
        const difficulty = await difficultyRes.text();
        const rewardSatoshi = await rewardRes.text(); // Reward in satoshis
        const stats = await statsRes.json(); // JSON response with hash_rate

        return {
            blockHeight: parseInt(blockHeight),
            difficulty: parseFloat(difficulty),
            blockReward: parseInt(rewardSatoshi),
            hashRate: stats.hash_rate / 1e10
        };
    } catch (error) {
        console.error('Error fetching blockchain metrics:', error);
        return {
            blockHeight: 885419, // Fallback value (example)
            difficulty: 110.57e12, // Fallback in terahashes (example)
            blockReward: 3.125, // Current reward as of March 2025
            hashRate: 200 // Fallback hash rate in EH/s (example)
        };
    }
}

// Function to calculate cumulative cost basis and gain over time
function calculateGainData(purchases, historicalPrices) {
    const sortedPurchases = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let cumulativeBtc = 0;
    let cumulativeCost = 0;
    const costBasisOverTime = sortedPurchases.map(p => {
        cumulativeBtc += p.quantity;
        cumulativeCost += p.totalCost;
        const costBasis = cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0;
        return { timestamp: new Date(p.timestamp + ' UTC'), costBasis, totalBtc: cumulativeBtc };
    });

    const gainData = historicalPrices.map(row => {
        const timestamp = new Date(row.Date);
        const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
        const relevantPurchase = costBasisOverTime.filter(p => p.timestamp <= timestamp).slice(-1)[0] || { costBasis: 0, totalBtc: 0 };
        const gain = relevantPurchase.totalBtc > 0 ? (price - relevantPurchase.costBasis) * relevantPurchase.totalBtc : 0;
        return { x: timestamp, y: gain };
    }).filter(point => !isNaN(point.x) && !isNaN(point.y));

    return gainData;
}

// Function to filter chart data based on date range
function filterDataByDateRange(startDate, endDate) {
    const filteredPriceData = originalPriceData.filter(point => point.x >= startDate && point.x <= endDate);
    const filteredCoinbaseData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate && point.exchange.toLowerCase() === 'coinbase');
    const filteredGeminiData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate && point.exchange.toLowerCase() === 'gemini');
    const filteredVenmoData = originalPurchaseData.filter(point => point.x >= startDate && point.x <= endDate && point.exchange.toLowerCase() === 'venmo');
    const filteredGainData = originalGainData.filter(point => point.x >= startDate && point.x <= endDate);

    priceChart.data.datasets[0].data = filteredPriceData;
    priceChart.data.datasets[1].data = filteredCoinbaseData;
    priceChart.data.datasets[1].pointRadius = filteredCoinbaseData.map(p => p.radius);
    priceChart.data.datasets[1].pointHoverRadius = filteredCoinbaseData.map(p => p.hoverRadius);
    priceChart.data.datasets[2].data = filteredGeminiData;
    priceChart.data.datasets[2].pointRadius = filteredGeminiData.map(p => p.radius);
    priceChart.data.datasets[2].pointHoverRadius = filteredGeminiData.map(p => p.hoverRadius);
    priceChart.data.datasets[3].data = filteredVenmoData;
    priceChart.data.datasets[3].pointRadius = filteredVenmoData.map(p => p.radius);
    priceChart.data.datasets[3].pointHoverRadius = filteredVenmoData.map(p => p.hoverRadius);
    priceChart.data.datasets[4].data = filteredGainData;
    priceChart.update();
}

// Function to initialize the slider with retry logic
function initializeSlider(minDate, maxDate) {
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');
    const maxRetries = 10;
    let retries = 0;

    function tryInitializeSlider() {
        if (typeof noUiSlider !== 'undefined') {
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

// Update the tracker
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
                quantity: parseFloat(p["Quantity Transacted"]),
                totalCost: parseFloat(totalCostStr),
                priceAtTransaction: parseFloat(priceAtTransactionStr),
                exchange: p.Exchange
            };
        }).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction) && p.exchange);

        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        const maxBtcQuantity = Math.max(...purchases.map(p => p.quantity));
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalBtc > 0 ? totalInvested / totalBtc : 0;
        const currentValue = totalBtc * currentPrice;
        const gainLoss = currentValue - totalInvested;
        const gainLossPercent = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

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

        // Update blockchain metrics
        document.getElementById('btc-block-height').innerText = blockchainMetrics.blockHeight.toLocaleString();
        document.getElementById('btc-difficulty').innerText = (blockchainMetrics.difficulty / 1e12).toFixed(2) + ' T'; // Convert to terahashes
        document.getElementById('btc-hash-rate').innerText = blockchainMetrics.hashRate.toFixed(2) + ' EH/s';
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

        originalPriceData = historicalPrices.map(row => {
            const timestamp = new Date(row.Date);
            const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
            return { x: timestamp, y: price };
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));

        originalPurchaseData = purchases.map(p => {
            const timestamp = new Date(p.timestamp + ' UTC');
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
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));

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
                        pointRadius: coinbasePurchases.map(p => p.radius),
                        pointHoverRadius: coinbasePurchases.map(p => p.hoverRadius),
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
                        pointRadius: geminiPurchases.map(p => p.radius),
                        pointHoverRadius: geminiPurchases.map(p => p.hoverRadius),
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
                        pointRadius: venmoPurchases.map(p => p.radius),
                        pointHoverRadius: venmoPurchases.map(p => p.hoverRadius),
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
                scales: {
                    x: {
                        type: 'time',
                        time: { unit: 'month', displayFormats: { month: 'MMM yyyy' } },
                        title: { display: true, text: 'Date', color: '#ffffff', font: { size: 14 } },
                        grid: { color: '#444' },
                        ticks: { color: '#ffffff' }
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
                                if (ctx.dataset.label === 'Coinbase Purchases' || ctx.dataset.label === 'Gemini Purchases' || ctx.dataset.label === 'Venmo Purchases') {
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

        const minDate = new Date(Math.min(...originalPriceData.map(d => d.x)));
        const maxDate = new Date(Math.max(...originalPriceData.map(d => d.x)));
        initializeSlider(minDate, maxDate);
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chart-error').innerText = `Error: ${error.message}`;
    }
}

// Run on load
updateTracker();
