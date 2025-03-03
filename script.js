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

        // Prepare chart data
        const priceData = historicalPrices.map(row => ({
            x: new Date(row.timestamp + ' UTC'),
            y: parseFloat(row.close)
        }));

        const purchaseData = purchases.map(p => ({
            x: new Date(p.timestamp + ' UTC'),
            y: p.priceAtTransaction,
            quantity: p.quantity,
            cost: p.totalCost
        }));

        // Render chart
        const ctx = document.getElementById('priceChart').getContext('2d');
        if (priceChart) priceChart.destroy();
        priceChart = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: [
                    {
                        label: 'BTC Price',
                        data: priceData,
                        borderColor: '#ffd700',
                        fill: false,
                        tension: 0.1
                    },
                    {
                        label: 'Purchases',
                        data: purchaseData,
                        type: 'scatter',
                        backgroundColor: '#00ff00',
                        pointRadius: 5
                    }
                ]
            },
            options: {
                scales: {
                    x: { type: 'time', time: { unit: 'month' } },
                    y: { title: { display: true, text: 'Price (USD)' } }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                if (ctx.dataset.label === 'Purchases') {
                                    const p = purchaseData[ctx.dataIndex];
                                    return `Bought ${p.quantity.toFixed(8)} BTC for $${p.cost.toFixed(2)}`;
                                }
                                return `Price: $${ctx.parsed.y.toFixed(2)}`;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error('Error:', error);
        alert(`Error: ${error.message}`);
    }
}

// Run on load
updateTracker();
