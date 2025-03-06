// script.js

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
        if (!response.ok) {
            throw new Error(`Failed to fetch BTC metrics: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        if (!data || data.length === 0) {
            throw new Error('Invalid BTC metrics received from API');
        }
        const btcData = data[0];
        console.log('Fetched BTC metrics:', btcData);
        return {
            currentPrice: btcData.current_price,
            marketCap: btcData.market_cap,
            volume24h: btcData.total_volume,
            priceChange24h: btcData.price_change_percentage_24h
        };
    } catch (error) {
        console.error('Error fetching BTC metrics:', error);
        // Fallback values if the API fails
        return {
            currentPrice: 93162.00,
            marketCap: 0,
            volume24h: 0,
            priceChange24h: 0
        };
    }
}

// Function to calculate cumulative cost basis and gain over time
function calculateGainData(purchases, historicalPrices) {
    // Sort purchases by timestamp
    const sortedPurchases = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Initialize cumulative variables
    let cumulativeBtc = 0;
    let cumulativeCost = 0;
    
    // Map purchases to cumulative cost basis
    const costBasisOverTime = sortedPurchases.map(p => {
        cumulativeBtc += p.quantity;
        cumulativeCost += p.totalCost;
        const costBasis = cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0;
        return {
            timestamp: new Date(p.timestamp + ' UTC'),
            costBasis: costBasis,
            totalBtc: cumulativeBtc
        };
    });

    // Calculate gain over time at each historical price point
    const gainData = historicalPrices.map(row => {
        const timestamp = new Date(row.Date);
        const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));

        // Find the most recent cost basis before this timestamp
        const relevantPurchase = costBasisOverTime
            .filter(p => p.timestamp <= timestamp)
            .slice(-1)[0] || { costBasis: 0, totalBtc: 0 };

        const gain = relevantPurchase.totalBtc > 0 ? (price - relevantPurchase.costBasis) * relevantPurchase.totalBtc : 0;
        return { x: timestamp, y: gain };
    }).filter(point => !isNaN(point.x) && !isNaN(point.y));

    return gainData;
}

// Function to filter chart data based on date range
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
                range: {
                    'min': minDate.getTime(),
                    'max': maxDate.getTime()
                },
                step: 24 * 60 * 60 * 1000, // Step by day
                behaviour: 'drag'
            });

            // Update labels and chart on slider change
            slider.noUiSlider.on('update', (values) => {
                const startDate = new Date(parseInt(values[0]));
                const endDate = new Date(parseInt(values[1]));
                
                // Update labels
                labels.innerHTML = `
                    <span>${startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                    <span>${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                `;

                // Filter chart data
                filterDataByDateRange(startDate, endDate);
            });

            // Initial label update
            labels.innerHTML = `
                <span>${minDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
                <span>${maxDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            `;
        } else if (retries < maxRetries) {
            retries++;
            console.log(`Retrying slider initialization (${retries}/${maxRetries})...`);
            setTimeout(tryInitializeSlider, 500); // Retry after 500ms
        } else {
            console.error('Failed to load noUiSlider after maximum retries.');
            document.getElementById('chart-error').innerText = 'Error: Date range slider not available - failed to load noUiSlider library.';
            // Hide the slider container
            slider.style.display = 'none';
            labels.style.display = 'none';
        }
    }

    tryInitializeSlider();
}

// Update the tracker
async function updateTracker() {
    try {
        // Load data
        const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
        const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
        const btcMetrics = await getBtcMetrics();
        const currentPrice = btcMetrics.currentPrice;

        // Process transactions with stricter parsing
        const purchases = transactions.map((p, index) => {
            // Log the raw row for debugging
            console.log(`Transaction Row ${index}:`, p);

            // Ensure properties exist before calling replace
            const totalCostStr = (p["Total (inclusive of fees and/or spread)"] || '').replace(/[^0-9.]/g, '');
            const priceAtTransactionStr = (p["Price at Transaction"] || '').replace(/[^0-9.]/g, '');

            return {
                timestamp: p.Timestamp,
                quantity: parseFloat(p["Quantity Transacted"]),
                totalCost: parseFloat(totalCostStr),
                priceAtTransaction: parseFloat(priceAtTransactionStr)
            };
        }).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost) && !isNaN(p.priceAtTransaction));

        // Calculate total BTC for scaling
        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        console.log(`Total BTC purchased: ${totalBtc}`);

        // Find the largest BTC quantity for scaling
        const maxBtcQuantity = Math.max(...purchases.map(p => p.quantity));
        console.log(`Largest BTC quantity: ${maxBtcQuantity}`);

        // Calculate metrics
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalBtc > 0 ? totalInvested / totalBtc : 0;
        const currentValue = totalBtc * currentPrice;
        const gainLoss = currentValue - totalInvested;
        const gainLossPercent = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

        // Update summary stats with formatted currencies
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

        // Update BTC metrics
        document.getElementById('btc-price').innerText = currentPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-market-cap').innerText = btcMetrics.marketCap.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-volume').innerText = btcMetrics.volume24h.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
        document.getElementById('btc-price-change').innerHTML = `
            <span class="${btcMetrics.priceChange24h >= 0 ? 'positive' : 'negative'}">
                ${btcMetrics.priceChange24h >= 0 ? '+' : ''}${btcMetrics.priceChange24h.toFixed(2)}%
            </span>
        `;

        // Populate transactions table
        const tableBody = document.getElementById('transactions-body');
        tableBody.innerHTML = purchases.map(p => `
            <tr>
                <td>${p.timestamp}</td>
                <td>${p.quantity.toFixed(8)}</td>
                <td>$${p.totalCost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
                <td>$${p.priceAtTransaction.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</td>
            </tr>
        `).join('');

        // Process historical prices
        originalPriceData = historicalPrices.map(row => {
            const timestamp = new Date(row.Date);
            const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
            return { x: timestamp, y: price };
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));

        // Process purchase data with scaled point sizes
        originalPurchaseData = purchases.map(p => {
            const timestamp = new Date(p.timestamp + ' UTC');
            // Use logarithmic scaling based on BTC quantity relative to the largest quantity
            const btcRatio = maxBtcQuantity > 0 ? p.quantity / maxBtcQuantity : 0;
            // Apply logarithmic scaling to make size differences more noticeable
            const btcFraction = btcRatio > 0 ? Math.log1p(btcRatio) / Math.log1p(1) : 0;
            // Scale the radius between 4 (min) and 20 (max) based on btcFraction
            const minRadius = 4;
            const maxRadius = 20;
            const radius = minRadius + btcFraction * (maxRadius - minRadius);
            const hoverRadius = radius + 2;

            // Debug the scaling calculation
            console.log(`Purchase BTC: ${p.quantity}, Ratio: ${btcRatio}, Log Fraction: ${btcFraction}, Radius: ${radius}`);

            return {
                x: timestamp,
                y: p.priceAtTransaction,
                quantity: p.quantity,
                cost: p.totalCost,
                radius: radius,
                hoverRadius: hoverRadius
            };
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));

        // Calculate cumulative gain over time
        originalGainData = calculateGainData(purchases, historicalPrices);

        // Debug chart data
        console.log('Historical Price Data:', originalPriceData);
        console.log('Purchase Data:', originalPurchaseData);
        console.log('Gain Data:', originalGainData);

        if (originalPriceData.length === 0) {
            document.getElementById('chart-error').innerText = 'Error: No valid historical price data available to plot.';
        }
        if (originalPurchaseData.length === 0) {
            document.getElementById('chart-error').innerText = 'Error: No valid purchase data available to plot.';
        }

        // Render chart
        const ctx = document.getElementById('priceChart').getContext('2d');
        if (priceChart) priceChart.destroy();
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'My Purchases',
                        data: originalPurchaseData,
                        type: 'scatter',
                        backgroundColor: '#F7931A',
                        pointRadius: originalPurchaseData.map(p => p.radius),
                        pointHoverRadius: originalPurchaseData.map(p => p.hoverRadius),
                        borderColor: '#000000',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'BTC Price (USD)',
                        data: originalPriceData,
                        borderColor: '#ffffff',
                        backgroundColor: 'rgba(255, 255, 255, 0.03)',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Cumulative Gain (USD)',
                        data: originalGainData,
                        borderColor: '#39FF14',
                        backgroundColor: 'rgba(57, 255, 20, 0.1)',
                        fill: false,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y1'
                    }
                ]
            },
            options: {
                responsive: true,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'month',
                            displayFormats: { month: 'MMM yyyy' }
                        },
                        title: {
                            display: true,
                            text: 'Date',
                            color: '#ffffff',
                            font: { size: 14 }
                        },
                        grid: { color: '#444' },
                        ticks: { color: '#ffffff' }
                    },
                    y: {
                        title: {
                            display: true,
                            text: 'Price (USD)',
                            color: '#ffffff',
                            font: { size: 14 }
                        },
                        grid: { color: '#444' },
                        ticks: {
                            color: '#ffffff',
                            callback: value => `$${value.toLocaleString()}`
                        }
                    },
                    y1: {
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Cumulative Gain (USD)',
                            color: '#ffffff',
                            font: { size: 14 }
                        },
                        grid: { drawOnChartArea: false },
                        ticks: {
                            color: '#ffffff',
                            callback: value => `$${value.toLocaleString()}`
                        },
                        suggestedMax: 100000,
                        suggestedMin: -500
                    }
                },
                plugins: {
                    legend: {
                        labels: { color: '#ffffff', font: { size: 12 } }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(0, 0, 0, 0.8)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        callbacks: {
                            label: ctx => {
                                if (ctx.dataset.label === 'My Purchases') {
                                    const p = originalPurchaseData[ctx.dataIndex];
                                    return `Bought ${p.quantity.toFixed(8)} BTC for $${p.cost.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
                                } else if (ctx.dataset.label === 'Cumulative Gain (USD)') {
                                    return `Gain: $${ctx.parsed.y.toLocaleString()}`;
                                }
                                return `Price: $${ctx.parsed.y.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });

        // Initialize date range slider with retry logic
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
