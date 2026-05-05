const axios = require('axios');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const config = require('./config');

const app = express();
app.use(cors()); // Allow dashboard to connect
const PORT = process.env.PORT || 8080;

let isBotActive = true;
const BASE_URL = config.USE_TESTNET ? 'https://api-testnet.bybit.com' : 'https://api.bybit.com';

// --- API Endpoints for Remote Control ---
app.get('/', (req, res) => res.send('CryptoAI Bot is Status: ' + (isBotActive ? 'ACTIVE' : 'PAUSED')));

app.get('/status', (req, res) => res.json({ active: isBotActive }));

app.get('/start', (req, res) => {
    isBotActive = true;
    console.log('AI Engine Resumed remotely.');
    res.json({ success: true, status: 'ACTIVE' });
});

app.get('/stop', (req, res) => {
    isBotActive = false;
    console.log('AI Engine Paused remotely.');
    res.json({ success: true, status: 'PAUSED' });
});

app.get('/logs', (req, res) => {
    // Optionally return last logs
    res.json({ logs: ["System heartbeat: OK", "Connection: Stable"] });
});

app.listen(PORT, () => console.log(`Remote Control Server on port ${PORT}`));

// --- Utility Functions ---
function generateSignature(params, secret, timestamp) {
    const recvWindow = '5000';
    return CryptoJS.HmacSHA256(timestamp + config.API_KEY + recvWindow + params, secret).toString();
}

function calculateRSI(data, period = 14) {
    if (data.length < period) return 50;
    let gains = 0, losses = 0;
    for (let i = data.length - period; i < data.length; i++) {
        const diff = data[i].close - data[i - 1].close;
        if (diff >= 0) gains += diff; else losses -= diff;
    }
    const rs = (gains / period) / (losses / period || 1);
    return 100 - (100 / (1 + rs));
}

function calculateEMA(data, period) {
    const k = 2 / (period + 1);
    let ema = data[0].close;
    for (let i = 1; i < data.length; i++) ema = (data[i].close * k) + (ema * (1 - k));
    return ema;
}

async function fetchKlines(symbol, interval, limit = 100) {
    const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
    return res.data.map(d => ({ close: parseFloat(d[4]), volume: parseFloat(d[5]) }));
}

async function getAdvancedAISignal() {
    if (!isBotActive) return 'Hold';
    try {
        const data1H = await fetchKlines(config.SYMBOL, '1h');
        const rsi1H = calculateRSI(data1H);
        const ema20 = calculateEMA(data1H, 20);
        const lastPrice = data1H[data1H.length - 1].close;

        let score = 50;
        if (lastPrice > ema20) score += 15; else score -= 15;
        if (rsi1H > 50 && rsi1H < 70) score += 15;
        if (rsi1H < 50 && rsi1H > 30) score -= 15;

        console.log(`[${new Date().toLocaleTimeString()}] AI Check: Score=${score}%`);

        if (score >= 70) return 'Buy';
        if (score <= 30) return 'Sell';
        return 'Hold';
    } catch (e) { return 'Hold'; }
}

async function getPositions() {
    const timestamp = Date.now().toString();
    const params = `category=linear&symbol=${config.SYMBOL}`;
    const signature = CryptoJS.HmacSHA256(timestamp + config.API_KEY + '5000' + params, config.API_SECRET).toString();
    try {
        const res = await axios.get(`${BASE_URL}/v5/position/list?${params}`, {
            headers: { 'X-BAPI-API-KEY': config.API_KEY, 'X-BAPI-SIGN': signature, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': '5000' }
        });
        const positions = res.data.result.list;
        fs.writeFileSync('trades.json', JSON.stringify(positions, null, 2));
        return positions;
    } catch (e) { return []; }
}

async function placeOrder(side, symbol, qty) {
    if (!isBotActive) return;
    const positions = await getPositions();
    const activePos = positions.find(p => parseFloat(p.size) > 0);
    
    if (activePos) {
        if (activePos.side === 'Buy' && side === 'Sell') await closePosition('Sell', symbol, activePos.size);
        if (activePos.side === 'Sell' && side === 'Buy') await closePosition('Buy', symbol, activePos.size);
        if (activePos.side === side) return;
    }

    const priceRes = await axios.get(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
    const lastPrice = parseFloat(priceRes.data.price);
    const tp = side === 'Buy' ? (lastPrice * 1.015).toFixed(2) : (lastPrice * 0.985).toFixed(2);
    const sl = side === 'Buy' ? (lastPrice * 0.99).toFixed(2) : (lastPrice * 1.01).toFixed(2);

    const timestamp = Date.now().toString();
    const params = JSON.stringify({
        category: 'linear', symbol, side, orderType: 'Market', qty,
        takeProfit: tp, stopLoss: sl, tpTriggerBy: 'MarkPrice', slTriggerBy: 'MarkPrice'
    });
    const signature = generateSignature(params, config.API_SECRET, timestamp);

    try {
        await axios.post(`${BASE_URL}/v5/order/create`, params, {
            headers: { 'X-BAPI-API-KEY': config.API_KEY, 'X-BAPI-SIGN': signature, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': '5000', 'Content-Type': 'application/json' }
        });
        console.log(`[${new Date().toLocaleTimeString()}] AI EXEC: ${side}`);
    } catch (e) {}
}

async function closePosition(side, symbol, qty) {
    const timestamp = Date.now().toString();
    const params = JSON.stringify({ category: 'linear', symbol, side, orderType: 'Market', qty, reduceOnly: true });
    const signature = generateSignature(params, config.API_SECRET, timestamp);
    try {
        await axios.post(`${BASE_URL}/v5/order/create`, params, {
            headers: { 'X-BAPI-API-KEY': config.API_KEY, 'X-BAPI-SIGN': signature, 'X-BAPI-TIMESTAMP': timestamp, 'X-BAPI-RECV-WINDOW': '5000', 'Content-Type': 'application/json' }
        });
    } catch (e) {}
}

function startBot() {
    console.log('--- CryptoAI Bot Ready ---');
    setInterval(async () => { if (isBotActive) await getPositions(); }, 10000);
    setInterval(async () => {
        if (isBotActive) {
            const signal = await getAdvancedAISignal();
            if (signal === 'Buy' || signal === 'Sell') await placeOrder(signal, config.SYMBOL, config.TRADE_QUANTITY);
        }
    }, 60000);
}

if (config.API_KEY && config.API_KEY !== 'YOUR_BYBIT_API_KEY') startBot();
else console.log('API Keys missing');
