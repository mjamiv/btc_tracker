// script.js
async function updateTracker() {
  // Fetch CSV file (assume it's named transactions.csv in the same directory)
  const response = await fetch('transactions.csv');
  const csvText = await response.text();

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
      const priceData = await priceResponse.json();
      const btcPrice = priceData.bitcoin.usd;

      const currentValue = totalBtc * btcPrice;
      const gain = currentValue - totalInvested;

      // Update UI
      document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
      document.getElementById('invested').innerText = `$${totalInvested.toFixed(2)}`;
      document.getElementById('value').innerText = `$${currentValue.toFixed(2)}`;
      document.getElementById('gain').innerText = `${gain >= 0 ? '+' : ''}$${gain.toFixed(2)}`;

      // Populate history table
      const history = document.getElementById('history');
      purchases.forEach(p => {
        const row = document.createElement('tr');
        row.innerHTML = `
          <td>${p.Timestamp}</td>
          <td>${p["Quantity Transacted"]}</td>
          <td>${p["Total (inclusive of fees and/or spread)"]}</td>
        `;
        history.appendChild(row);
      });
    }
  });
}

updateTracker();
