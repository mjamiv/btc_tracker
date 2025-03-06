// script.js

let priceChart = null;
let originalPriceData = [];
let originalPurchaseData = [];
let originalGainData = [];

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

async function getBtcMetrics() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin');
        const data = await response.json();
        const btcData = data[0];
        return {
            currentPrice: btcData.current_price,
            marketCap: btcData.market_cap,
            volume24h: btcData.total_volume,
            priceChange24h: btcData.price_change_percentage_24h
        };
    } catch (error) {
        console.error('Error fetching BTC metrics:', error);
        return {
            currentPrice: 93162.00,
            marketCap: 0,
            volume24h: 0,
            priceChange24h: 0
        };
    }
}

function calculateGainData(purchases, historicalPrices) {
    const sortedPurchases = [...purchases].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    let cumulativeBtc = 0;
    let cumulativeCost = 0;

    const costBasisOverTime = sortedPurchases.map(p => {
        cumulativeBtc += p.quantity;
        cumulativeCost += p.totalCost;
        const costBasis = cumulativeCost / cumulativeBtc;
        return { timestamp: new Date(p.timestamp + ' UTC'), costBasis, totalBtc: cumulativeBtc };
    });

    return historicalPrices.map(row => {
        const timestamp = new Date(row.Date);
        const price = parseFloat((row.Price || '').replace(/[^0-9.]/g, ''));

        const relevantPurchase = costBasisOverTime
            .filter(p => p.timestamp <= timestamp)
            .slice(-1)[0] || { costBasis: 0, totalBtc: 0 };

        const gain = (price - relevantPurchase.costBasis) * relevantPurchase.totalBtc;
        return { x: timestamp, y: gain };
    }).filter(point => !isNaN(point.x) && !isNaN(point.y));
}

function filterDataByDateRange(startDate, endDate) {
    priceChart.data.datasets[0].data = originalPriceData.filter(p => p.x >= startDate && p.x <= endDate);
    priceChart.data.datasets[1].data = originalPurchaseData.filter(p => p.x >= startDate && p.x <= endDate);
    priceChart.data.datasets[2].data = originalGainData.filter(p => p.x >= startDate && p.x <= endDate);
    priceChart.update();
}

function initializeSlider(minDate, maxDate) {
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');

    noUiSlider.create(slider, {
        start: [minDate.getTime(), maxDate.getTime()],
        connect: true,
        range: { min: minDate.getTime(), max: maxDate.getTime() },
        step: 24 * 60 * 60 * 1000
    });

    slider.noUiSlider.on('update', values => {
        const startDate = new Date(parseInt(values[0]));
        const endDate = new Date(parseInt(values[1]));
        labels.innerHTML = `
            <span>${startDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
            <span>${endDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
        `;
        filterDataByDateRange(startDate, endDate);
    });
}

async function updateTracker() {
    const transactions = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv');
    const historicalPrices = await fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv');
    const btcMetrics = await getBtcMetrics();

    const purchases = transactions.map(p => ({
        timestamp: p.Timestamp,
        quantity: parseFloat(p["Quantity Transacted"]),
        totalCost: parseFloat((p["Total (inclusive of fees and/or spread)"] || '').replace(/[^0-9.]/g, '')),
        priceAtTransaction: parseFloat((p["Price at Transaction"] || '').replace(/[^0-9.]/g, ''))
    })).filter(p => !isNaN(p.quantity) && !isNaN(p.totalCost));

    originalPriceData = historicalPrices.map(row => ({
        x: new Date(row.Date),
        y: parseFloat((row.Price || '').replace(/[^0-9.]/g, ''))
    })).filter(p => !isNaN(p.x) && !isNaN(p.y));

    originalPurchaseData = purchases.map(p => ({
        x: new Date(p.timestamp + ' UTC'),
        y: p.priceAtTransaction,
        quantity: p.quantity,
        cost: p.totalCost,
        radius: 5 + Math.log1p(p.quantity) * 3,
        hoverRadius: 7 + Math.log1p(p.quantity) * 3
    }));

    originalGainData = calculateGainData(purchases, historicalPrices);

    if (priceChart) priceChart.destroy();
    priceChart = new Chart(document.getElementById('priceChart'), {
        type: 'line',
        data: { datasets: [
            { label: 'BTC Price', data: originalPriceData, borderColor: '#fff' },
            { label: 'Purchases', data: originalPurchaseData, type: 'scatter', backgroundColor: '#F7931A', borderColor: '#000' },
            { label: 'Cumulative Gain', data: originalGainData, borderColor: '#39FF14', yAxisID: 'y1' }
        ]},
        options: { responsive: true }
    });

    initializeSlider(new Date(Math.min(...originalPriceData.map(d => d.x))), new Date(Math.max(...originalPriceData.map(d => d.x))));
}

updateTracker();
