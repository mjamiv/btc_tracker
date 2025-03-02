async function updateTracker() {
  try {
    const response = await fetch('transactions.csv');
    if (!response.ok) throw new Error('Failed to load transactions.csv');
    const csvText = await response.text();

    Papa.parse(csvText, {
      header: true,
      complete: async (result) => {
        const purchases = result.data.filter(row => 
          row["Transaction Type"] === "Buy" || row["Transaction Type"] === "Advanced Trade Buy"
        );

        const totalBtc = purchases.reduce((sum, p) => sum + parseFloat(p["Quantity Transacted"] || 0), 0);
        const totalInvested = purchases.reduce((sum, p) => sum + parseFloat(p["Total (inclusive of fees and/or spread)"].replace('$', '') || 0), 0);

        const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd');
        if (!priceResponse.ok) throw new Error('Failed to fetch BTC price');
        const priceData = await priceResponse.json();
        const btcPrice = priceData.bitcoin.usd;

        const currentValue = totalBtc * btcPrice;
        const gain = currentValue - totalInvested;

        document.getElementById('total-btc').innerText = totalBtc.toFixed(8);
        document.getElementById('invested').innerText = `$${totalInvested.toFixed(2)}`;
        document.getElementById('value').innerText = `$${currentValue.toFixed(2)}`;
        document.getElementById('gain').innerText = `${gain >= 0 ? '+' : ''}$${gain.toFixed(2)}`;

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
  } catch (error) {
    console.error(error);
    alert(`Error: ${error.message}`);
  }
}

updateTracker();
