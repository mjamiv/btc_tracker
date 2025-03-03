// script.js

// Variable to hold the chart instance
let priceChart = null;

// Function to fetch historical Bitcoin prices from CSV
async function getHistoricalPrices() {
  const csvUrl = 'https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv?cache=' + new Date().getTime();
  const response = await fetch(csvUrl);
  if (!response.ok) throw new Error('Failed to load historical_btc_prices.csv');
  const csvText = await response.text();

  let historicalData;
  Papa.parse(csvText, {
    header: true,
    complete: (result) => {
      historicalData = result.data.map(row => ({
        timestamp: new Date(row.timestamp + ' UTC').getTime(),
        price: parseFloat(row.close)
      })).filter(row => !isNaN(row.timestamp) && !isNaN(row.price));
    }
  });
  return historicalData;
}

// Define time zones based on your purchase periods
const timeZones = [
  { name: 'Feb 1, 2025 - Feb 25, 2025', start: new Date('2025-02-01'), end: new Date('2025-02-25 23:59:59') },
  { name: 'Jan 1, 2025 - Jan 13, 2025', start: new Date('2025-01-01'), end: new Date('2025-01-13 23:59:59') },
  { name: 'Dec 18, 2024 - Dec 31, 2024', start: new Date('2024-12-18'), end: new Date('2024-12-31 23:59:59') },
];

// Function to calculate metrics for each time zone
function calculateTimeZoneMetrics(purchases, totalBtc, currentBtcPrice) {
  const metrics = timeZones.map(zone => {
    const zonePurchases = purchases.filter(p => {
      const purchaseDate = new Date(p.Timestamp + ' UTC');
      return purchaseDate >= zone.start && purchaseDate <= zone.end;
    });

    const btcInZone = zonePurchases.reduce((sum, p) => sum + parseFloat(p["Quantity Transacted"]), 0);
    const costInZone = zonePurchases.reduce((sum, p) => sum + parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '')), 0);
    const avgPurchasePrice = btcInZone > 0 ? costInZone / btcInZone : 0;
    const percentOfBitcoin = totalBtc > 0 ? (btcInZone / totalBtc) * 100 : 0;
    const currentValue = btcInZone * currentBtcPrice;
    const pl = currentValue - costInZone;
    const percentPl = costInZone > 0 ? (pl / costInZone) * 100 : 0;

    return {
      name: zone.name,
      avgPurchasePrice: avgPurchasePrice.toFixed(2),
      percentOfBitcoin: percentOfBitcoin.toFixed(2),
      cost: costInZone.toFixed(2),
      currentValue: currentValue.toFixed(2),
      pl: pl.toFixed(2),
      percentPl: percentPl.toFixed(2)
    };
  });

  return metrics.filter(zone => zone.cost > 0); // Only show zones with purchases
}

// Main function to update the tracker
async function updateTracker() {
  try {
    // Fetch and parse purchase data
    const csvUrl = 'https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv?cache=' + new Date().getTime();
    const response = await fetch(csvUrl);
    if (!response.ok) throw new Error('Failed to load transactions.csv');
    const csvText = await response.text();

    let purchases;
    Papa.parse(csvText, {
      header: true,
      complete: (result) => {
        purchases = result.data.map(p => ({
          ...p,
          purchasePrice: parseFloat(p["Price at Transaction"].replace('$', '').replace(',', ''))
        }));
      }
    });

    // Calculate overall stats
    const totalBtc = purchases.reduce((sum, p) => sum + parseFloat(p["Quantity Transacted"]), 0);
    const totalInvested = purchases.reduce((sum, p) => sum + parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '')), 0);

    // Fetch current Bitcoin price
    const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
    if (!priceResponse.ok) throw new Error('Failed to fetch current BTC price');
    const priceData = await priceResponse.json();
    const currentBtcPrice = priceData.bitcoin.usd;

    const currentValue = totalBtc * currentBtcPrice;
    const gain = currentValue - totalInvested;

    // Update overall stats UI
    document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
    document.getElementById('invested').innerText = `$${totalInvested.toFixed(2)}`;
    document.getElementById('value').innerText = `$${currentValue.toFixed(2)}`;
    document.getElementById('gain').innerText = `${gain >= 0 ? '+' : ''}$${gain.toFixed(2)}`;
    document.getElementById('gain').className = gain >= 0 ? 'gain-positive' : 'gain-negative';

    // Populate transaction history table
    const historyTable = document.getElementById('history');
    historyTable.innerHTML = '';
    purchases.forEach(p => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${p.Timestamp}</td>
        <td>${p["Quantity Transacted"]}</td>
        <td>${p["Total (inclusive of fees and/or spread)"]}</td>
      `;
      historyTable.appendChild(row);
    });

    // Populate time zone breakdown table
    const timeZoneMetrics = calculateTimeZoneMetrics(purchases, totalBtc, currentBtcPrice);
    const timeZoneTable = document.getElementById('timezone-breakdown');
    timeZoneTable.innerHTML = '';
    timeZoneMetrics.forEach(zone => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${zone.name}</td>
        <td>$${zone.avgPurchasePrice}</td>
        <td>${zone.percentOfBitcoin}%</td>
        <td>$${zone.cost}</td>
        <td>$${zone.currentValue}</td>
        <td>${zone.pl >= 0 ? '+' : ''}$${zone.pl}</td>
        <td class="${zone.percentPl >= 0 ? 'gain-positive' : 'gain-negative'}">${zone.percentPl >= 0 ? '+' : ''}${zone.percentPl}%</td>
      `;
      timeZoneTable.appendChild(row);
    });

    // Render the chart
    const historicalData = await getHistoricalPrices();
    const priceDataPoints = historicalData.map(point => ({
      x: new Date(point.timestamp),
      y: point.price
    }));

    const purchaseDataPoints = purchases.map(p => {
      const cost = parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', ''));
      return {
        x: new Date(p.Timestamp + ' UTC'),
        y: p.purchasePrice,
        cost: cost,
        btc: parseFloat(p["Quantity Transacted"]),
        size: Math.sqrt(cost) * 0.5 + 2
      };
    });

    const ctx = document.getElementById('priceChart').getContext('2d');
    if (priceChart) priceChart.destroy();
    priceChart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          {
            label: 'BTC Price (USD)',
            data: priceDataPoints,
            borderColor: '#ffd700',
            backgroundColor: 'rgba(255, 215, 0, 0.1)',
            fill: true,
            tension: 0.1,
            yAxisID: 'y'
          },
          {
            label: 'My Purchases',
            data: purchaseDataPoints,
            type: 'scatter',
            backgroundColor: '#00ff00',
            pointRadius: purchaseDataPoints.map(p => p.size),
            pointHoverRadius: purchaseDataPoints.map(p => p.size + 2),
            yAxisID: 'y'
          }
        ]
      },
      options: {
        responsive: true,
        scales: {
          x: {
            type: 'time',
            time: { unit: 'month' },
            title: { display: true, text: 'Date', color: '#ffffff' },
            grid: { color: '#444' },
            ticks: { color: '#ffffff' }
          },
          y: {
            title: { display: true, text: 'BTC Price (USD)', color: '#ffffff' },
            grid: { color: '#444' },
            ticks: { color: '#ffffff' }
          }
        },
        plugins: {
          legend: { labels: { color: '#ffffff' } },
          tooltip: {
            callbacks: {
              label: function(context) {
                if (context.dataset.label === 'My Purchases') {
                  const p = purchaseDataPoints[context.dataIndex];
                  return `Bought ${p.btc.toFixed(8)} BTC for $${p.cost.toFixed(2)}`;
                }
                return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
              }
            }
          }
        }
      }
    });
  } catch (error) {
    console.error('Error:', error);
    alert(`Error updating tracker: ${error.message}`);
  }
}

// Initial load
updateTracker();
