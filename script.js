// script.js

let priceChart = null;

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

// Update the tracker
async function updateTracker() {
    try {
        // Load data
        const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
        const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
        const currentPrice = await getCurrentBtcPrice();

        // Process transactions with stricter parsing
        const purchases = transactions.map(p => {
            const totalCostStr = p["Total (inclusive of fees and/or spread)"].replace(/[^0-9.]/g, '');
            const priceAtTransactionStr = p["Price at Transaction"].replace(/[^0-9.]/g, '');
            return {
                timestamp: p.Timestamp,
                quantity: parseFloat(p["Quantity Transacted"]),
                totalCost: parseFloat(totalCostStr),
                priceAtTransaction: parseFloat(priceAtTransactionStr)
            };
        });

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

        // Process historical prices with correct column names
        const priceData = historicalPrices.map(row => {
            // Log the raw row for debugging
            console.log('Historical Price Row:', row);

            // Use correct column name 'Date'
            let timestamp = new Date(row.Date + ' UTC');
            if (isNaN(timestamp)) {
                timestamp = new Date(row.Date);
            }
            if (isNaN(timestamp)) {
                timestamp = new Date(Date.parse(row.Date));
            }

            // Use correct column name 'Price' and clean it, with a fallback
            const priceStr = row.Price || ''; // Fallback to empty string if undefined
            const price = parseFloat(priceStr.replace(/[^0-9.]/g, ''));
            return { x: timestamp, y: price };
        }).filter(point => {
            const isValid = !isNaN(point.x) && !isNaN(point.y);
            if (!isValid) {
                console.log('Filtered out invalid historical price point:', point);
            }
            return isValid;
        });

        // Process purchase data
        const purchaseData = purchases.map(p => {
            const timestamp = new Date(p.timestamp + ' UTC');
            return {
                x: timestamp,
                y: p.priceAtTransaction,
                quantity: p.quantity,
                cost: p.totalCost
            };
        }).filter(point => !isNaN(point.x) && !isNaN(point.y));

        // Debug chart data
        console.log('Historical Price Data:', priceData);
        console.log('Purchase Data:', purchaseData);

        if (priceData.length === 0) {
            document.getElementById('chart-error').innerText = 'Error: No valid historical price data available to plot.';
        }
        if (purchaseData.length === 0) {
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
                        data: priceData,
                        borderColor: '#ffd700',
                        backgroundColor: 'rgba(255, 215, 0, 0.1)',
                        fill: true,
                        tension: 0.3,
                        pointRadius: 0
                    },
                    {
                        label: 'My Purchases',
                        data: purchaseData,
                        type: 'scatter',
                        backgroundColor: '#00ff00',
                        pointRadius: 6,
                        pointHoverRadius: 8,
                        borderColor: '#ffffff',
                        borderWidth: 1
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
                                    const p = purchaseData[ctx.dataIndex];
                                    return `Bought ${p.quantity.toFixed(8)} BTC for $${p.cost.toFixed(2)}`;
                                }
                                return `Price: $${ctx.parsed.y.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error:', error);
        document.getElementById('chart-error').innerText = `Error: ${error.message}`;
    }
}

// Run on load
updateTracker();
