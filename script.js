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

// Get current BTC price
async function getCurrentBtcPrice() {
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    if (!response.ok) throw new Error('Failed to fetch BTC price');
    const data = await response.json();
    return data.bitcoin.usd;
}

// Update the tracker
async function updateTracker() {
    try {
        // Load data
        const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
        const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
        const currentPrice = await getCurrentBtcPrice();

        // Process transactions
        const purchases = transactions.map(p => ({
            timestamp: p.Timestamp,
            quantity: parseFloat(p["Quantity Transacted"]),
            totalCost: parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '')),
            priceAtTransaction: parseFloat(p["Price at Transaction"].replace('$', '').replace(',', ''))
        }));

        // Calculate metrics
        const totalBtc = purchases.reduce((sum, p) => sum + p.quantity, 0);
        const totalInvested = purchases.reduce((sum, p) => sum + p.totalCost, 0);
        const costBasis = totalInvested / totalBtc;
        const currentValue = totalBtc * currentPrice;
        const gainLoss = currentValue - totalInvested;
        const gainLossPercent = (gainLoss / totalInvested) * 100;

        // Update summary
        document.getElementById('summary').innerHTML = `
            <p>Total BTC: ${totalBtc.toFixed(8)}</p>
            <p>Total Invested: $${totalInvested.toFixed(2)}</p>
            <p>Cost Basis: $${costBasis.toFixed(2)}</p>
            <p>Current Value: $${currentValue.toFixed(2)}</p>
            <p>Gain/Loss: <span class="${gainLoss >= 0 ? 'positive' : 'negative'}">
                ${gainLoss >= 0 ? '+' : ''}$${gainLoss.toFixed(2)} (${gainLossPercent.toFixed(2)}%)
            </span></p>
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
