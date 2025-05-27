/* ------------------------------------------------------------------
   BTC Tracker – full script with Cost Basis line + padded y1 axis
   ------------------------------------------------------------------ */

let priceChart              = null;
let originalPriceData       = [];
let originalCostBasisData   = [];   // NEW
let originalPurchaseData    = [];
let originalGainData        = [];

// ─────────────────────────────────────────────────────────── CSV fetch
async function fetchCSV(url) {
    const response = await fetch(url + '?cache=' + Date.now());
    if (!response.ok) throw new Error(`Failed to load ${url}`);
    const text = await response.text();
    return new Promise(resolve => {
        Papa.parse(text, { header: true, complete: res => resolve(res.data) });
    });
}

// ─────────────────────────────────────────────────────── BTC metrics
async function getBtcMetrics() {
    try {
        const res  = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=bitcoin');
        if (!res.ok) throw new Error(`Failed to fetch BTC metrics (${res.status})`);
        const data = await res.json();
        const btc  = data[0];
        return {
            currentPrice:     btc.current_price,
            marketCap:        btc.market_cap,
            volume24h:        btc.total_volume,
            priceChange24h:   btc.price_change_percentage_24h
        };
    } catch (err) {
        console.error('Error fetching BTC metrics:', err);
        // fallback demo values
        return { currentPrice: 93162, marketCap: 0, volume24h: 0, priceChange24h: 0 };
    }
}

// ───────────────────────────────────────────────── Blockchain metrics
async function getBlockchainMetrics() {
    try {
        const [heightRes, diffRes, rewardRes, statsRes] = await Promise.all([
            fetch('https://blockchain.info/q/getblockcount'),
            fetch('https://blockchain.info/q/getdifficulty'),
            fetch('https://blockchain.info/q/bcperblock'),
            fetch('https://blockchain.info/stats?format=json')
        ]);
        if (!heightRes.ok || !diffRes.ok || !rewardRes.ok || !statsRes.ok)
            throw new Error('Failed to fetch blockchain metrics');

        return {
            blockHeight: parseInt(await heightRes.text()),
            difficulty:  parseFloat(await diffRes.text()),
            blockReward: parseFloat(await rewardRes.text()),     // satoshis
            hashRate:    (await statsRes.json()).hash_rate / 1e9 // EH/s
        };
    } catch (err) {
        console.error('Error fetching blockchain metrics:', err);
        // rough fallback demo values
        return { blockHeight: 514_714, difficulty: 110.57e12, blockReward: 3.521, hashRate: 200 };
    }
}

// ─────────────────────────────────────────────── cumulative gain calc
function calculateGainData(purchases, historicalPrices) {
    const sorted = [...purchases].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
    let cumBtc = 0, cumCost = 0;
    const costBasisTimeline = sorted.map(p => {
        cumBtc  += p.quantity;
        cumCost += p.totalCost;
        return {
            timestamp: new Date(p.timestamp + ' UTC'),
            costBasis: cumBtc > 0 ? cumCost / cumBtc : 0,
            totalBtc:  cumBtc
        };
    });

    return historicalPrices.map(row => {
        const ts    = new Date(row.Date);
        const price = parseFloat((row.Price || '').replace(/[^0-9.]/g,''));
        const last  = costBasisTimeline.filter(p => p.timestamp <= ts).slice(-1)[0] || { costBasis:0,totalBtc:0 };
        const gain  = last.totalBtc > 0 ? (price - last.costBasis) * last.totalBtc : 0;
        return { x: ts, y: gain };
    }).filter(pt => !isNaN(pt.x) && !isNaN(pt.y));
}

// ─────────────────────────────────────────────────── date-range filter
function filterDataByDateRange(startDate, endDate) {
    const f = (arr) => arr.filter(pt => pt.x >= startDate && pt.x <= endDate);

    const filteredPriceData      = f(originalPriceData);
    const filteredCostBasisData  = f(originalCostBasisData);
    const filteredCoinbaseData   = originalPurchaseData.filter(pt => pt.x >= startDate && pt.x <= endDate && pt.exchange.toLowerCase()==='coinbase');
    const filteredGeminiData     = originalPurchaseData.filter(pt => pt.x >= startDate && pt.x <= endDate && pt.exchange.toLowerCase()==='gemini');
    const filteredVenmoData      = originalPurchaseData.filter(pt => pt.x >= startDate && pt.x <= endDate && pt.exchange.toLowerCase()==='venmo');
    const filteredGainData       = f(originalGainData);

    priceChart.data.datasets[0].data = filteredPriceData;
    priceChart.data.datasets[1].data = filteredCostBasisData;
    priceChart.data.datasets[2].data = filteredCoinbaseData;
    priceChart.data.datasets[2].pointRadius      = filteredCoinbaseData.map(p=>p.radius);
    priceChart.data.datasets[2].pointHoverRadius = filteredCoinbaseData.map(p=>p.hoverRadius);
    priceChart.data.datasets[3].data = filteredGeminiData;
    priceChart.data.datasets[3].pointRadius      = filteredGeminiData.map(p=>p.radius);
    priceChart.data.datasets[3].pointHoverRadius = filteredGeminiData.map(p=>p.hoverRadius);
    priceChart.data.datasets[4].data = filteredVenmoData;
    priceChart.data.datasets[4].pointRadius      = filteredVenmoData.map(p=>p.radius);
    priceChart.data.datasets[4].pointHoverRadius = filteredVenmoData.map(p=>p.hoverRadius);
    priceChart.data.datasets[5].data = filteredGainData;

    priceChart.update();
}

// ─────────────────────────────────────────────── slider initialisation
function initializeSlider(minDate, maxDate) {
    const slider = document.getElementById('date-range-slider');
    const labels = document.getElementById('date-range-labels');
    const maxRetries = 10;
    let retries = 0;

    function tryInit() {
        if (typeof noUiSlider !== 'undefined') {
            noUiSlider.create(slider, {
                start: [minDate.getTime(), maxDate.getTime()],
                connect: true,
                range: { min: minDate.getTime(), max: maxDate.getTime() },
                step: 24*60*60*1000,
                behaviour: 'drag'
            });

            slider.noUiSlider.on('update', values => {
                const [s,e] = values.map(v=>new Date(+v));
                labels.innerHTML = `<span>${s.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span>
                                    <span>${e.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span>`;
                filterDataByDateRange(s,e);
            });

            labels.innerHTML = `<span>${minDate.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span>
                                <span>${maxDate.toLocaleDateString('en-US',{month:'short',year:'numeric'})}</span>`;
        } else if (++retries<=maxRetries) {
            console.log(`Retrying slider init (${retries}/${maxRetries})…`);
            setTimeout(tryInit,500);
        } else {
            console.error('Failed to load noUiSlider');
            document.getElementById('chart-error').innerText = 'Error: Date slider not available.';
            slider.style.display = labels.style.display = 'none';
        }
    }
    tryInit();
}

// ────────────────────────────────────────────────────────── main driver
async function updateTracker() {
    try {
        /* ─── Load CSVs ─────────────────────────────────────── */
        const [transactions, historicalPrices] = await Promise.all([
            fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/transactions.csv'),
            fetchCSV('https://raw.githubusercontent.com/mjamiv/btc_tracker/main/historical_btc_prices.csv')
        ]);

        /* ─── Live metrics ─────────────────────────────────── */
        const btcMetrics        = await getBtcMetrics();
        const blockchainMetrics = await getBlockchainMetrics();
        const currentPrice      = btcMetrics.currentPrice;

        /* ─── Transactions to objects ──────────────────────── */
        const purchases = transactions.map(row => ({
            timestamp:         row.Timestamp,
            quantity:          parseFloat(row["Quantity Transacted"]),
            totalCost:         parseFloat((row["Total"]||'').replace(/[^0-9.]/g,'')),
            priceAtTransaction:parseFloat((row["Price at Transaction"]||'').replace(/[^0-9.]/g,'')),
            exchange:          row.Exchange
        })).filter(p => ![p.quantity,p.totalCost,p.priceAtTransaction].some(isNaN) && p.exchange);

        /* ─── Portfolio math ───────────────────────────────── */
        const totalBtc      = purchases.reduce((s,p)=>s+p.quantity,0);
        const maxBtcQty     = Math.max(...purchases.map(p=>p.quantity));
        const totalInvested = purchases.reduce((s,p)=>s+p.totalCost,0);
        const costBasis     = totalBtc>0 ? totalInvested/totalBtc : 0;
        const currentValue  = totalBtc*currentPrice;
        const gainLoss      = currentValue - totalInvested;
        const gainPct       = totalInvested>0 ? gainLoss/totalInvested*100 : 0;

        /* ─── DOM portfolio widgets ────────────────────────── */
        const $ = (id)=>document.getElementById(id);
        $('total-btc').innerText       = totalBtc.toFixed(8);
        $('invested').innerText        = totalInvested.toLocaleString('en-US',{style:'currency',currency:'USD'});
        $('cost-basis').innerText      = costBasis.toLocaleString('en-US',{style:'currency',currency:'USD'});
        $('current-value').innerText   = currentValue.toLocaleString('en-US',{style:'currency',currency:'USD'});
        $('gain-loss').innerHTML       = `<span class="${gainLoss>=0?'positive':'negative'}">
                                             ${gainLoss>=0?'+':''}${gainLoss.toLocaleString('en-US',{style:'currency',currency:'USD'})}
                                             <span class="percentage">(${gainPct.toFixed(2)}%)</span>
                                          </span>`;

        $('btc-price').innerText       = currentPrice.toLocaleString('en-US',{style:'currency',currency:'USD'});
        $('btc-market-cap').innerText  = btcMetrics.marketCap.toLocaleString('en-US',{style:'currency',currency:'USD'});
        $('btc-volume').innerText      = btcMetrics.volume24h.toLocaleString('en-US',{style:'currency',currency:'USD'});
        $('btc-price-change').innerHTML= `<span class="${btcMetrics.priceChange24h>=0?'positive':'negative'}">
                                             ${btcMetrics.priceChange24h>=0?'+':''}${btcMetrics.priceChange24h.toFixed(2)}%
                                          </span>`;

        $('btc-block-height').innerText= blockchainMetrics.blockHeight.toLocaleString();
        $('btc-difficulty').innerText  = (blockchainMetrics.difficulty/1e12).toFixed(2)+' T';
        $('btc-hash-rate').innerText   = blockchainMetrics.hashRate.toFixed(2)+' EH/s';
        $('btc-block-reward').innerText= blockchainMetrics.blockReward.toFixed(3)+' BTC';

        /* ─── Build series arrays ──────────────────────────── */
        originalPriceData = historicalPrices.map(r=>{
            const ts = new Date(r.Date);
            const y  = parseFloat((r.Price||'').replace(/[^0-9.]/g,''));
            return { x:ts, y };
        }).filter(pt=>!isNaN(pt.x)&&!isNaN(pt.y));

        // NEW: cost-basis line (flat at average cost)
        originalCostBasisData = originalPriceData.map(pt=>({ x:pt.x, y:costBasis }));

        originalPurchaseData = purchases.map(p=>{
            const ts = new Date(p.timestamp);
            const ratio = maxBtcQty>0 ? p.quantity/maxBtcQty : 0;
            const frac  = ratio>0 ? Math.log1p(ratio)/Math.log1p(1) : 0;
            const rMin=4,rMax=20;
            return {
                x:ts, y:p.priceAtTransaction,
                quantity:p.quantity, cost:p.totalCost,
                radius:rMin+frac*(rMax-rMin),
                hoverRadius:rMin+frac*(rMax-rMin)+2,
                exchange:p.exchange
            };
        });

        originalGainData = calculateGainData(purchases,historicalPrices);

        /* ─── y1 padded max for gain axis ─────────────────── */
        const y1Max = Math.max(...originalGainData.map(d=>d.y))*1.25;

        /* ─── Build chart ─────────────────────────────────── */
        if (priceChart) priceChart.destroy();
        const ctx = document.getElementById('priceChart').getContext('2d');
        priceChart = new Chart(ctx,{
            type:'line',
            data:{ datasets:[
                /* 0 */{
                    label:'BTC Price (USD)',
                    data: originalPriceData,
                    borderColor:'#ffffff',
                    backgroundColor:'rgba(255,255,255,0.03)',
                    fill:false, tension:0.3, pointRadius:0, yAxisID:'y', order:1
                },
                /* 1 – NEW */{
                    label:'Cost Basis (USD)',
                    data: originalCostBasisData,
                    borderColor:'#FFA500',
                    backgroundColor:'rgba(255,165,0,0.08)',
                    borderDash:[6,4],
                    fill:false, tension:0, pointRadius:0, yAxisID:'y', order:1
                },
                /* 2 */{
                    label:'Coinbase Purchases',
                    data: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='coinbase'),
                    type:'scatter',
                    backgroundColor:'#1E90FF',
                    pointRadius: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='coinbase').map(p=>p.radius),
                    pointHoverRadius: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='coinbase').map(p=>p.hoverRadius),
                    borderColor:'#000', borderWidth:1, yAxisID:'y', order:0
                },
                /* 3 */{
                    label:'Gemini Purchases',
                    data: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='gemini'),
                    type:'scatter',
                    backgroundColor:'#800080',
                    pointRadius: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='gemini').map(p=>p.radius),
                    pointHoverRadius: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='gemini').map(p=>p.hoverRadius),
                    borderColor:'#000', borderWidth:1, yAxisID:'y', order:0
                },
                /* 4 */{
                    label:'Venmo Purchases',
                    data: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='venmo'),
                    type:'scatter',
                    backgroundColor:'#00FF00',
                    pointRadius: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='venmo').map(p=>p.radius),
                    pointHoverRadius: originalPurchaseData.filter(p=>p.exchange.toLowerCase()==='venmo').map(p=>p.hoverRadius),
                    borderColor:'#000', borderWidth:1, yAxisID:'y', order:0
                },
                /* 5 */{
                    label:'Cumulative Gain (USD)',
                    data: originalGainData,
                    borderColor:'#39FF14',
                    backgroundColor:'rgba(57,255,20,0.1)',
                    fill:false, tension:0.3, pointRadius:0, yAxisID:'y1', order:2
                }
            ]},
            options:{
                responsive:true,
                scales:{
                    x:{
                        type:'time',
                        time:{ unit:'month', displayFormats:{ month:'MMM yy' }},
                        title:{ display:true, text:'Date', color:'#fff', font:{size:14}},
                        grid:{ color:'#444' }, ticks:{ color:'#fff'}
                    },
                    y:{
                        title:{ display:true, text:'Price (USD)', color:'#fff', font:{size:14}},
                        grid:{ color:'#444' },
                        ticks:{ color:'#fff', callback:v=>v.toLocaleString()}
                    },
                    y1:{
                        position:'right',
                        title:{ display:true, text:'Cumulative Gain (USD)', color:'#fff', font:{size:14}},
                        grid:{ drawOnChartArea:false },
                        ticks:{ color:'#fff', callback:v=>v.toLocaleString()},
                        suggestedMax: y1Max
                    }
                },
                plugins:{
                    legend:{ labels:{ color:'#fff', font:{size:12}}},
                    tooltip:{
                        backgroundColor:'rgba(0,0,0,0.8)',
                        titleColor:'#fff', bodyColor:'#fff',
                        callbacks:{
                            label: ctx=>{
                                const lbl=ctx.dataset.label;
                                if(['Coinbase Purchases','Gemini Purchases','Venmo Purchases'].includes(lbl)){
                                    const p = ctx.raw;
                                    return `${lbl}: Bought ${p.quantity.toFixed(8)} BTC for ${p.cost.toLocaleString('en-US',{style:'currency',currency:'USD'})}`;
                                } else if(lbl==='Cumulative Gain (USD)'){
                                    return `Gain: ${ctx.parsed.y.toLocaleString()}`;
                                } else if(lbl==='Cost Basis (USD)'){
                                    return `Cost Basis: ${costBasis.toLocaleString('en-US',{style:'currency',currency:'USD'})}`;
                                }
                                return `Price: ${ctx.parsed.y.toLocaleString()}`;
                            }
                        }
                    }
                }
            }
        });

        /* ─── Date-range slider ────────────────────────────── */
        const minDate = new Date(Math.min(...originalPriceData.map(d=>d.x)));
        const maxDate = new Date(new Date().setDate(new Date().getDate()+60));
        initializeSlider(minDate,maxDate);

    } catch(err) {
        console.error('Error:',err);
        document.getElementById('chart-error').innerText = `Error: ${err.message}`;
    }
}

// ───────────────────────────────────────────────────────── on-load
updateTracker();
