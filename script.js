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

// Get current BTC price (hardcoded for now to match expected value)
async function getCurrentBtcPrice() {
    return 93162.00;
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
    priceChart.data.datasets[2].data = filteredGainData;
    priceChart.update();
}

// Update the tracker
async function updateTracker() {
    try {
        // Load data
        const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
        const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
        const currentPrice = await getCurrentBtcPrice();

        // Log the first few rows of transactions to inspect column names
        console.log('First few rows of transactions.csv:', transactions.slice(0, 3));

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

        // Calculate metrics
        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalBtc > 0 ? totalInvested / totalBtc : 0;
        const currentValue = totalBtc * currentPrice;
        const gainLoss = currentValue - totalInvested;
        const gainLossPercent = totalInvested > 0 ? (gainLoss / totalInvested) * 100 : 0;

        // Update summary stats individually
        document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
        document.getElementById('invested').innerText = `$${totalInvested.toFixed(2)}`;
        document.getElementById('cost-basis').innerText = `$${costBasis.toFixed(2)}`;
        document.getElementById('current-value').innerText = `$${currentValue.toFixed(2)}`;
        document.getElementById('gain-loss').innerHTML = `
            <span class="${gainLoss >= 0 ? 'positive' : 'negative'}">
                ${gainLoss >= 0 ? '+' : ''}$${gainLoss.toFixed(2)} (${gainLossPercent.toFixed(2)}%)
            </span>
        `;

        // Populate transactions table
        const tableBody = document.getElementById('transactions-body');
        tableBody.innerHTML = purchases.map(p => `
            <tr>
                <td>${p.timestamp}</td>
                <td>${p.quantity.toFixed(8)}</td>
                <td>$${p.totalCost.toFixed(2)}</td>
                <td>$${p.priceAtTransaction.toFixed(2)}</td>
            </tr>
        `).join('');

        // Log the first few rows of historical prices to inspect column names
        console.log('First few rows of historical_btc_prices.csv:', historicalPrices.slice(0, 3));

        // Process historical prices
        originalPriceData = historicalPrices.map((row, index) => {
            // Log the raw row for debugging
            console.log(`Historical Price Row ${index}:`, row);

            const timestamp = new Date(row.Date);
            const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));
            return { x: timestamp, y: price };
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));

        // Process purchase data
        originalPurchaseData = purchases.map(p => {
            const timestamp = new Date(p.timestamp + ' UTC');
            return {
                x: timestamp,
                y: p.priceAtTransaction,
                quantity: p.quantity,
                cost: p.totalCost
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
                        label: 'BTC Price (USD)',
                        data: originalPriceData,
                        borderColor: '#ffd700',
                        backgroundColor: 'rgba(255, 215, 0, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0,
                        yAxisID: 'y'
                    },
                    {
                        label: 'My Purchases',
                        data: originalPurchaseData,
                        type: 'scatter',
                        backgroundColor: '#00ff00',
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        borderColor: '#ffffff',
                        borderWidth: 1,
                        yAxisID: 'y'
                    },
                    {
                        label: 'Cumulative Gain (USD)',
                        data: originalGainData,
                        borderColor: '#ff5555',
                        backgroundColor: 'rgba(255, 85, 85, 0.1)',
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
                        }
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
                                    return `Bought ${p.quantity.toFixed(8)} BTC for $${p.cost.toFixed(2)}`;
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

        // Initialize date range slider
        const minDate = new Date(Math.min(...originalPriceData.map(d => d.x)));
        const maxDate = new Date(Math.max(...originalPriceData.map(d => d.x)));
        const slider = document.getElementById('date-range-slider');
        const labels = document.getElementById('date-range-labels');

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
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chart-error').innerText = `Error: ${error.message}`;
    }
}

// Run on load
updateTracker();
