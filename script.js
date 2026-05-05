// CryptoAI - Diagnostic & Premium Engine
let chart, candleSeries;
let currentSymbol = "BTCUSDT";
let socket;

function addLog(msg, isError = false) {
    const logs = document.getElementById('trade-logs');
    if (!logs) return;
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    if (isError) entry.style.color = '#ff4444';
    entry.innerHTML = `<span style="color: #555;">[${new Date().toLocaleTimeString()}]</span> ${msg}`;
    logs.prepend(entry);
}

function initChart() {
    const chartContainer = document.getElementById('chart-container');
    if (!chartContainer) return;
    chartContainer.innerHTML = '';

    try {
        chart = LightweightCharts.createChart(chartContainer, {
            layout: { background: { type: 'solid', color: '#161a1e' }, textColor: '#848e9c', fontSize: 12, fontFamily: 'Inter' },
            grid: { vertLines: { color: 'rgba(43, 49, 57, 0.2)' }, horzLines: { color: 'rgba(43, 49, 57, 0.2)' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: '#2b3139' },
            timeScale: { borderColor: '#2b3139', timeVisible: true },
        });

        candleSeries = chart.addCandlestickSeries({
            upColor: '#0ecb81', downColor: '#f6465d', borderDownColor: '#f6465d',
            borderUpColor: '#0ecb81', wickDownColor: '#f6465d', wickUpColor: '#0ecb81',
        });
        addLog("Neural Engine: Graphics Initialized.");
    } catch(e) {
        addLog("Chart Init Error: Check if library is loaded.", true);
    }
}

async function syncMarketData() {
    addLog(`Syncing ${currentSymbol} data...`);
    try {
        const url = `https://api.binance.com/api/v3/klines?symbol=${currentSymbol}&interval=1h&limit=100`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        
        const formatted = data.map(d => ({
            time: d[0] / 1000, open: parseFloat(d[1]), high: parseFloat(d[2]),
            low: parseFloat(d[3]), close: parseFloat(d[4]), volume: parseFloat(d[5])
        }));
        
        candleSeries.setData(formatted);
        performAnalysis(formatted);
        addLog("Data Stream: Connected & Synchronized.");
    } catch (e) {
        addLog(`Network Error: ${e.message}. Trying backup stream...`, true);
    }
}

function performAnalysis(history) {
    const last = history[history.length - 1];
    
    // Technical Calculations
    let gains = 0, losses = 0, period = 14;
    for (let i = history.length - period; i < history.length; i++) {
        const diff = history[i].close - history[i - 1].close;
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rsi = 100 - (100 / (1 + ((gains/period) / (losses/period || 1))));
    
    const k = 2 / (21);
    let ema = history[0].close;
    for (let i = 1; i < history.length; i++) ema = (history[i].close * k) + (ema * (1 - k));

    // Update UI
    document.getElementById('val-rsi').innerText = rsi.toFixed(1);
    document.getElementById('val-macd').innerText = (last.close - ema).toFixed(2);
    document.getElementById('live-price').innerText = `$${last.close.toLocaleString()}`;
    
    let score = 50;
    if (last.close > ema) score += 20; else score -= 20;
    if (rsi > 50) score += 10; else score -= 10;

    const signalEl = document.getElementById('ai-signal');
    const color = score > 60 ? '#0ecb81' : (score < 40 ? '#f6465d' : '#848e9c');
    signalEl.innerText = score > 60 ? "STRONG BUY" : (score < 40 ? "STRONG SELL" : "WAITING");
    signalEl.style.color = color;
    
    const conf = Math.min(Math.max(Math.abs(score - 50) * 2, 10), 95);
    document.querySelector('.bar-fill').style.width = `${conf}%`;
    document.querySelector('.percentage').innerText = `${conf}%`;
}

function startLiveStream() {
    if (socket) socket.close();
    socket = new WebSocket(`wss://stream.binance.com:9443/ws/${currentSymbol.toLowerCase()}@kline_1h`);
    socket.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        const k = msg.k;
        candleSeries.update({
            time: k.t / 1000, open: parseFloat(k.o), high: parseFloat(k.h),
            low: parseFloat(k.l), close: parseFloat(k.c)
        });
        document.getElementById('live-price').innerText = `$${parseFloat(k.c).toLocaleString()}`;
    };
}

document.getElementById('asset-select').addEventListener('change', function() {
    currentSymbol = this.value;
    syncMarketData();
    startLiveStream();
});

window.onload = () => {
    initChart();
    syncMarketData();
    startLiveStream();
    setInterval(syncMarketData, 60000);
    setInterval(async () => {
        try {
            const res = await fetch('trades.json');
            if (!res.ok) return;
            const positions = await res.json();
            const tbody = document.getElementById('live-positions-body');
            if (!positions || positions.length === 0 || parseFloat(positions[0].size) === 0) {
                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 40px; color: var(--text-secondary);">No active exposure</td></tr>';
                return;
            }
            tbody.innerHTML = '';
            positions.forEach(pos => {
                if (parseFloat(pos.size) === 0) return;
                const pnl = parseFloat(pos.unrealisedPnl || 0);
                tbody.innerHTML += `<tr><td><b style="color: white">${pos.symbol}</b></td><td style="color: ${pos.side === 'Buy' ? '#0ecb81' : '#f6465d'}">${pos.side.toUpperCase()}</td><td>$${parseFloat(pos.avgPrice).toLocaleString()}</td><td>${pos.size}</td><td style="color: ${pnl >= 0 ? '#0ecb81' : '#f6465d'}">${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT</td></tr>`;
            });
        } catch(e) {}
    }, 5000);
// UI Controls & Remote Control
document.getElementById('auto-trade-btn').addEventListener('click', async function() {
    const status = document.querySelector('.status-text');
    const botUrlInput = document.getElementById('bot-url');
    const botUrl = botUrlInput.value || "http://localhost:8080";
    
    if (this.innerText.includes("START")) {
        addLog("Sending Start signal to AI Engine...");
        try {
            const res = await fetch(`${botUrl}/start`);
            const data = await res.json();
            if (data.success) {
                this.innerText = "PAUSE AI ENGINE";
                this.style.background = "var(--bg-secondary)";
                status.innerText = "ACTIVE";
                status.style.color = "var(--success)";
                addLog("AI Engine Resumed remotely.");
            }
        } catch(e) {
            addLog("Remote Error: Bot not reachable. Check URL.", true);
        }
    } else {
        addLog("Sending Pause signal to AI Engine...");
        try {
            const res = await fetch(`${botUrl}/stop`);
            const data = await res.json();
            if (data.success) {
                this.innerText = "START AI ENGINE";
                this.style.background = "var(--accent-gradient)";
                status.innerText = "PAUSED";
                status.style.color = "var(--text-secondary)";
                addLog("AI Engine Paused remotely.");
            }
        } catch(e) {
            addLog("Remote Error: Bot not reachable. Check URL.", true);
        }
    }
});
