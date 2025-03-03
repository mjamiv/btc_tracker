// script.js

// Variable to hold the chart instance
let priceChart = null;

// Function to get or update historical prices from localStorage
async function getHistoricalPrices() {
  // Fetch the historical price CSV
  const csvResponse = await fetch('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
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

async function updateTracker() {
  try {
    // Fetch transactions CSV
    const csvResponse = await fetch('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
    if (!csvResponse.ok) throw new Error('Failed to load transactions.csv');
    const csvText = await csvResponse.text();

    // Parse transactions CSV with PapaParse
    Papa.parse(csvText, {
      header: true,
      complete: async (result) => {
        // No Transaction Type to filter; assume all rows are purchases
        const purchases = result.data;

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
          console.log('Earliest Price Date:', earliestPriceDate); // Debug

          const purchaseDataPoints = purchases
            .filter(p => {
              const purchaseDate = new Date(p.Timestamp + ' UTC');
              console.log('Purchase Date (raw):', p.Timestamp, 'Parsed:', purchaseDate); // Debug
              return purchaseDate >= earliestPriceDate;
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

          // Find the corresponding price for each purchase
          const purchasePrices = purchaseDataPoints.map(p => {
            const matchingPrice = priceDataPoints.find(hp => hp.date.getTime() === p.date.getTime());
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
