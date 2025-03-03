// script.js

// Variable to hold the chart instance
let priceChart = null;

// Clear localStorage on load to avoid stale data
localStorage.removeItem('btcHistoricalPrices');
console.log('localStorage cleared');

// Function to get or update historical prices from localStorage
async function getHistoricalPrices() {
  // Fetch the historical price CSV with cache-busting
  const csvResponse = await fetch('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv?cache=' + new Date().getTime());
  if (!csvResponse.ok) throw new Error('Failed to load historical_btc_prices.csv');
  const csvText = await csvResponse.text();

  let historicalData;
  Papa.parse(csvText, {
    header: true,
    complete: (result) => {
      historicalData = result.data.map(row => ({
        timestamp: new Date(row.timestamp + ' UTC').getTime(), // Explicitly parse as UTC
        price: parseFloat(row.close)
      })).filter(row => !isNaN(row.timestamp) && !isNaN(row.price)); // Filter out invalid rows
    }
  });

  // Store in localStorage or retrieve existing appended data
  const storedData = localStorage.getItem('btcHistoricalPrices');
  let prices = storedData ? JSON.parse(storedData) : historicalData;

  // Get the last date in the dataset
  const lastDate = new Date(prices[prices.length - 1].timestamp);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Normalize to midnight

  // If the last date is before today, fetch the current price and append
  if (lastDate < today) {
    try {
      const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
      if (!priceResponse.ok) throw new Error('Failed to fetch BTC price for appending');
      const priceData = await priceResponse.json();
      const btcPrice = priceData.bitcoin.usd;
      const newEntry = { timestamp: today.getTime(), price: btcPrice };
      prices.push(newEntry);
      // Sort by date
      prices.sort((a, b) => a.timestamp - b.timestamp);
      // Update localStorage
      localStorage.setItem('btcHistoricalPrices', JSON.stringify(prices));
    } catch (error) {
      console.error('Error appending new price:', error);
    }
  }

  return prices;
}

// Helper function to normalize dates for comparison (remove time component)
function normalizeDate(date) {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0); // Normalize using UTC
  return normalized;
}

// Define time zones based on transaction dates
const timeZones = [
  { name: 'Feb 1, 2025 - Feb 25, 2025', start: new Date('2025-02-01'), end: new Date('2025-02-25 23:59:59') },
  { name: 'Jan 1, 2025 - Jan 13, 2025', start: new Date('2025-01-01'), end: new Date('2025-01-13 23:59:59') },
  { name: 'Dec 18, 2024 - Dec 31, 2024', start: new Date('2024-12-18'), end: new Date('2024-12-31 23:59:59') },
];

// Function to group purchases by time zone and calculate metrics
function calculateTimeZoneMetrics(purchases, totalBtc, currentBtcPrice) {
  const timeZoneMetrics = timeZones.map(zone => {
    // Filter purchases within this time zone
    const zonePurchases = purchases.filter(p => {
      const purchaseDate = new Date(p.Timestamp + ' UTC');
      return purchaseDate >= zone.start && purchaseDate <= zone.end;
    });

    // Calculate metrics for this time zone
    const btcInZone = zonePurchases.reduce((sum, p) => sum + parseFloat(p["Quantity Transacted"] || 0), 0);
    const costInZone = zonePurchases.reduce((sum, p) => sum + parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '') || 0), 0);
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
      percentPl: percentPl.toFixed(2),
      btcInZone: btcInZone.toFixed(8)
    };
  });

  return timeZoneMetrics.filter(zone => zone.btcInZone > 0); // Only include time zones with purchases
}

async function updateTracker() {
  try {
    // Fetch transactions CSV with cache-busting
    const csvResponse = await fetch('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv?cache=' + new Date().getTime());
    if (!csvResponse.ok) throw new Error('Failed to load transactions.csv');
    const csvText = await csvResponse.text();

    // Parse transactions CSV with PapaParse
    Papa.parse(csvText, {
      header: true,
      complete: async (result) => {
        // No Transaction Type to filter; assume all rows are purchases
        const purchases = result.data;

        // Calculations for overall stats
        const totalBtc = purchases.reduce((sum, p) => sum + parseFloat(p["Quantity Transacted"] || 0), 0);
        const totalInvested = purchases.reduce((sum, p) => sum + parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '') || 0), 0);

        // Get current BTC price
        const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        if (!priceResponse.ok) throw new Error('Failed to fetch BTC price');
        const priceData = await priceResponse.json();
        const btcPrice = priceData.bitcoin.usd;

        const currentValue = totalBtc * btcPrice;
        const gain = currentValue - totalInvested;

        // Update UI for overall stats
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

        // Calculate and display time zone breakdown
        const timeZoneMetrics = calculateTimeZoneMetrics(purchases, totalBtc, btcPrice);
        const timeZoneTable = document.getElementById('timezone-breakdown');
        timeZoneTable.innerHTML = ''; // Clear existing rows
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

        // Render chart
        try {
          // Get historical prices (from CSV + appended)
          const historicalData = await getHistoricalPrices();
          console.log('Historical Data:', historicalData); // Debug

          const priceDataPoints = historicalData.map(point => ({
            date: normalizeDate(new Date(point.timestamp)),
            price: point.price
          }));
          console.log('Price Data Points:', priceDataPoints); // Debug

          // Prepare purchase data for plotting
          const earliestPriceDate = new Date(priceDataPoints[0].date);
          const latestPriceDate = new Date(priceDataPoints[priceDataPoints.length - 1].date);
          console.log('Earliest Price Date:', earliestPriceDate, 'Latest Price Date:', latestPriceDate); // Debug

          const purchaseDataPoints = purchases
            .filter(p => {
              const purchaseDate = new Date(p.Timestamp + ' UTC');
              console.log('Purchase Date (raw):', p.Timestamp, 'Parsed:', purchaseDate); // Debug
              const isWithinRange = purchaseDate >= earliestPriceDate && purchaseDate <= latestPriceDate;
              if (!isWithinRange) {
                console.warn(`Purchase at ${p.Timestamp} is outside historical price range and will not be plotted.`);
              }
              return isWithinRange;
            })
            .map(p => {
              const cost = parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', ''));
              const purchaseDate = normalizeDate(new Date(p.Timestamp + ' UTC'));
              return {
                date: purchaseDate,
                cost: cost,
                btc: parseFloat(p["Quantity Transacted"]),
                size: Math.sqrt(cost) * 0.5 + 2 // Adjusted scaling for green dots
              };
            });
          console.log('Purchase Data Points:', purchaseDataPoints); // Debug

          // Find the corresponding price for each purchase with a fallback
          const purchasePrices = purchaseDataPoints.map(p => {
            // Try exact match first
            let matchingPrice = priceDataPoints.find(hp => hp.date.getTime() === p.date.getTime());
            // If no exact match, find the closest date
            if (!matchingPrice) {
              matchingPrice = priceDataPoints.reduce((closest, hp) => {
                const hpDate = hp.date.getTime();
                const pDate = p.date.getTime();
                const diff = Math.abs(hpDate - pDate);
                if (!closest || diff < closest.diff) {
                  return { diff, price: hp.price, date: hp.date };
                }
                return closest;
              }, null);
            }
            console.log('Matching Purchase:', p.date, 'Historical Price Date:', matchingPrice ? matchingPrice.date : 'No match', 'Price:', matchingPrice ? matchingPrice.price : 'N/A', 'Size:', p.size); // Debug
            return {
              ...p,
              price: matchingPrice ? matchingPrice.price : null
            };
          }).filter(p => p.price !== null); // Filter out unmatched purchases
          console.log('Purchase Prices (final):', purchasePrices); // Debug

          // Create the chart
          const ctx = document.getElementById('priceChart').getContext('2d');
          // Destroy existing chart if it exists
          if (priceChart) {
            priceChart.destroy();
            console.log('Previous chart destroyed'); // Debug
          }

          // Create new chart
          priceChart = new Chart(ctx, {
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
                  data: purchasePrices.map(p => ({ x: p.date, y: p.price })),
                  type: 'scatter',
                  backgroundColor: '#00ff00',
                  pointRadius: purchasePrices.map(p => p.size),
                  pointHoverRadius: purchasePrices.map(p => p.size + 2), // Slightly larger on hover
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
                  grid: {
                    color: '#444'
                  },
                  ticks: {
                    color: '#ffffff'
                  }
                },
                y: {
                  title: {
                    display: true,
                    text: 'BTC Price (USD)',
                    color: '#ffffff'
                  },
                  grid: {
                    color: '#444'
                  },
                  ticks: {
                    color: '#ffffff'
                  }
                }
              },
              plugins: {
                legend: {
                  labels: {
                    color: '#ffffff'
                  }
                },
                tooltip: {
                  callbacks: {
                    label: function(context) {
                      if (context.dataset.label === 'My Purchases') {
                        const purchase = purchasePrices[context.dataIndex];
                        return `Bought ${purchase.btc.toFixed(8)} BTC for $${purchase.cost.toFixed(2)}`;
                      }
                      return `${context.dataset.label}: $${context.parsed.y.toFixed(2)}`;
                    }
                  }
                }
              }
            }
          });
          console.log('New chart created:', priceChart); // Debug
        } catch (chartError) {
          console.error('Chart Error:', chartError);
          document.getElementById('chart-error').innerText = `Failed to load chart: ${chartError.message}`;
        }
      }
    });
  } catch (error) {
    console.error('Main Error:', error);
    alert(`Error: ${error.message}`);
  }
}

// Initial load
updateTracker();
