import axios from 'axios';

const API_BASE = "http://localhost:8000/api";
const WS_BASE  = "ws://localhost:8000";

const api = axios.create({ baseURL: API_BASE, timeout: 30000 });

// ── Market ─────────────────────────────────────────────────────────────────

export const getTickers = async (
  symbols = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT"
) => (await api.get(`/market/tickers?symbols=${encodeURIComponent(symbols)}`)).data;

/**
 * Returns: { symbol, interval, data: OHLCV[], signal: {signal,confidence,reasons,score,indicators} }
 */
export const getHistory = async (symbol, interval = "1h", limit = 100) => {
  const sym = symbol.replace("/", "_");
  return (await api.get(`/market/history?symbol=${encodeURIComponent(sym)}&interval=${interval}&limit=${limit}`)).data;
};

export const getSignal = async (symbol, timeframe = "1h") => {
  const sym = symbol.replace("/", "_");
  return (await api.get(`/market/signal/${sym}?timeframe=${timeframe}`)).data;
};

// ── Kronos Forecast ─────────────────────────────────────────────────────────
/**
 * Returns: { symbol, forecast: [{t,p,hi,lo,timestamp}], model, timestamp }
 */
export const getPrediction = async (symbol, timeframe = "1h", predLen = 24) => {
  const sym = symbol.replace("/", "_");
  return (await api.get(`/predict/${sym}?timeframe=${timeframe}&pred_len=${predLen}`)).data;
};

// ── Swarm ────────────────────────────────────────────────────────────────────
/**
 * Returns: { symbol, agents: [...], timestamp }
 */
export const runSwarm = async (symbol) =>
  (await api.post("/swarm/run", { symbol })).data;

// ── Backtesting ──────────────────────────────────────────────────────────────

export const runBacktest = async (symbol) =>
  (await api.get(`/backtest/run?symbol=${encodeURIComponent(symbol)}`)).data;

// ── OpenTrader Strategy Engine ────────────────────────────────────────────────

export const getOpenTraderStatus = async () =>
  (await api.get("/opentrader/status")).data;

/**
 * Run GRID / DCA / RSI strategy calculation or paper trade.
 * @param {string} strategy  "grid" | "dca" | "rsi"
 * @param {string} symbol    "BTC/USDT"
 * @param {object} params    Strategy-specific params (highPrice, lowPrice, gridLevels, ...)
 * @param {boolean} paper    true = paper mode
 */
export const runOpenTraderStrategy = async (strategy, symbol, params, paper = true) =>
  (await api.post("/opentrader/strategy", { strategy, symbol, params, paper })).data;

/**
 * Run OpenTrader backtest (CLI when available, Python fallback otherwise).
 */
export const runOpenTraderBacktest = async (strategy, symbol, timeframe, from_date, to_date, params = {}) =>
  (await api.post("/opentrader/backtest", { strategy, symbol, timeframe, from_date, to_date, params })).data;

// ── News ─────────────────────────────────────────────────────────────────────

export const getNews = async (symbols = "BTC,ETH,crypto", limit = 20) =>
  (await api.get(`/news?symbols=${encodeURIComponent(symbols)}&limit=${limit}`)).data;

export const getSymbolNews = async (symbol, limit = 10) => {
  const sym = symbol.replace("/USDT","").replace("/USD","").replace("/","");
  return (await api.get(`/news/${sym}?limit=${limit}`)).data;
};

// ── Portfolio / Bots ──────────────────────────────────────────────────────────

export const getPortfolio  = async () => (await api.get("/portfolio")).data;
export const getBots        = async () => (await api.get("/bots")).data;
export const toggleBot      = async (id) => (await api.post(`/bots/${id}/toggle`)).data;

// ── Config / Stats ────────────────────────────────────────────────────────────

export const getConfig      = async () => (await api.get("/config")).data;
export const updateConfig   = async (cfg) => (await api.post("/config", cfg)).data;
export const getSystemStats = async () => (await api.get("/system/stats")).data;

// ── Agent chat ────────────────────────────────────────────────────────────────

export const chatWithAgent  = async (message) =>
  (await api.post("/agent/chat", { message })).data;

// ── WebSockets ────────────────────────────────────────────────────────────────

export const createMarketWS = () => new WebSocket(`${WS_BASE}/ws/market`);
export const createLogsWS   = () => new WebSocket(`${WS_BASE}/ws/logs`);
