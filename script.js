// script.js
async function updateTracker() {
  try {
    // Fetch CSV file
    const csvResponse = await fetch('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
    if (!csvResponse.ok) throw new Error('Failed to load transactions.csv');
    const csvText = await csvResponse.text();

    // Parse CSV with PapaParse
    Papa.parse(csvText, {
      header: true,
      complete: async (result) => {
        const purchases = result.data.filter(row => 
          row["Transaction Type"] === "Buy" || row["Transaction Type"] === "Advanced Trade Buy"
        );

        // Calculations
        const totalBtc = purchases.reduce((sum, p) => sum + parseFloat(p["Quantity Transacted"] || 0), 0);
        const totalInvested = purchases.reduce((sum, p) => sum + parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '') || 0), 0);

        // Get current BTC price
        const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        if (!priceResponse.ok) throw new Error('Failed to fetch BTC price');
        const priceData = await priceResponse.json();
        const btcPrice = priceData.bitcoin.usd;

        const currentValue = totalBtc * btcPrice;
        const gain = currentValue - totalInvested;

        // Update UI
        document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
        document.getElementById('invested').innerText = `$${totalInvested.toFixed(2)}`;
        document.getElementById('value').innerText = `$${currentValue.toFixed(2)}`;
        document.getElementById('gain').innerText = `${gain >= 0 ? '+' : ''}$${gain.toFixed(2)}`;
        document.getElementById('gain').className = gain >= 0 ? 'gain-positive' : 'gain-negative';

        // Populate history table
        const history = document.getElementById('history');
        history.innerHTML = ''; // Clear existing rows
        purchases.forEach(p => {
          const row = document.createElement('tr');
          row.innerHTML = `
            <td>${p.Timestamp}</td>
            <td>${p["Quantity Transacted"]}</td>
            <td>${p["Total (inclusive of fees and/or spread)"]}</td>
          `;
          history.appendChild(row);
        });

        // Fetch historical BTC prices (last 2 years for better range)
        const historicalResponse = await fetch('https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=730');
        if (!historicalResponse.ok) throw new Error('Failed to fetch historical BTC prices');
        const historicalData = await historicalResponse.json();
        const priceDataPoints = historicalData.prices.map(point => ({
          date: new Date(point[0]),
          price: point[1]
        }));

        // Prepare purchase data for plotting
        const purchaseDataPoints = purchases.map(p => {
          const cost = parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', ''));
          return {
            date: new Date(p.Timestamp),
            cost: cost,
            btc: parseFloat(p["Quantity Transacted"]),
            size: Math.sqrt(cost) * 2 // Scale point size based on cost
          };
        });

        // Create the chart
        const ctx = document.getElementById('priceChart').getContext('2d');
        if (window.priceChart) window.priceChart.destroy(); // Destroy existing chart if refreshing
        window.priceChart = new Chart(ctx, {
          type: 'line',
          data: {
            datasets: [
              {
                label: 'BTC Price (USD)',
                data: priceDataPoints.map(p => ({ x: p.date, y: p.price })),
                borderColor: '#ffd700',
                backgroundColor: 'rgba(255, 215, 0, 0.1)',
                fill: true,
                tension: 0.1,
                yAxisID: 'y'
              },
              {
                label: 'My Purchases',
                data: purchaseDataPoints.map(p => ({ x: p.date, y: priceDataPoints.find(hp => hp.date.toDateString() === p.date.toDateString())?.price || 0 })),
                type: 'scatter',
                backgroundColor: '#00ff00',
                pointRadius: purchaseDataPoints.map(p => p.size),
                pointHoverRadius: purchaseDataPoints.map(p => p.size + 5),
                yAxisID: 'y'
              }
            ]
          },
          options: {
            responsive: true,
            scales: {
              x: {
                type: 'time',
                time: {
                  unit: 'month'
                },
                title: {
                  display: true,
                  text: 'Date',
                  color: '#ffffff'
                },
                grid: { color: '#444' },
                ticks: { color: '#ffffff' }
              },
              y: {
                title: {
                  display: true,
                  text: 'BTC Price (USD)',
                  color: '#ffffff'
                },
                grid: { color: '#444' },
                ticks: { color: '#ffffff' }
              }
            },
            plugins: {
              legend: {
                labels: { color: '#ffffff' }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    if (context.dataset.label === 'My Purchases') {
                      const purchase = purchaseDataPoints[context.dataIndex];
                      return `Bought ${purchase.btc.toFixed(8)} BTC for $${purchase.cost.toFixed(2)}`;
                    }
                    return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
                  }
                }
              }
            }
          }
        });
      }
    });
  } catch (error) {
    console.error(error);
    alert(`Error: ${error.message}`);
  }
}

// Initial load
updateTracker();
