import axios from 'axios';

const API_BASE = "http://localhost:8000/api";
const WS_BASE  = "ws://localhost:8000";

const api = axios.create({ baseURL: API_BASE, timeout: 15000 });

export const getTickers = async (symbols = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT") => {
    const res = await api.get(`/market/tickers?symbols=${encodeURIComponent(symbols)}`);
    return res.data;
};

export const getHistory = async (symbol, interval = "1h", limit = 100) => {
    const res = await api.get(`/market/history?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=${limit}`);
    return res.data;
};

export const chatWithAgent = async (message) => {
    const res = await api.post('/agent/chat', { message });
    return res.data;
};

export const getSignal = async (symbol, timeframe = "1h") => {
    const sym = symbol.replace("/", "_");
    const res = await api.get(`/market/signal/${sym}?timeframe=${timeframe}`);
    return res.data;
};

export const getPrediction = async (symbol, timeframe = "1h", predLen = 24) => {
    const sym = symbol.replace("/", "_");
    const res = await api.get(`/predict/${sym}?timeframe=${timeframe}&pred_len=${predLen}`);
    return res.data;
};

export const getConfig = async () => {
    const res = await api.get('/config');
    return res.data;
};

export const updateConfig = async (config) => {
    const res = await api.post('/config', config);
    return res.data;
};

export const getNews = async (symbols = "BTC,ETH,crypto", limit = 20) => {
    const res = await api.get(`/news?symbols=${encodeURIComponent(symbols)}&limit=${limit}`);
    return res.data;
};

export const getSymbolNews = async (symbol, limit = 10) => {
    const sym = symbol.replace("/USDT","").replace("/USD","").replace("/","");
    const res = await api.get(`/news/${sym}?limit=${limit}`);
    return res.data;
};

export const getPortfolio = async () => {
    const res = await api.get('/portfolio');
    return res.data;
};

export const getBots = async () => {
    const res = await api.get('/bots');
    return res.data;
};

export const toggleBot = async (botId) => {
    const res = await api.post(`/bots/${botId}/toggle`);
    return res.data;
};

export const getSystemStats = async () => {
    const res = await api.get('/system/stats');
    return res.data;
};

export const createMarketWS = () => new WebSocket(`${WS_BASE}/ws/market`);
export const createLogsWS   = () => new WebSocket(`${WS_BASE}/ws/logs`);
