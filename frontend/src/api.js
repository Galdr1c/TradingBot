import axios from 'axios';

const DEFAULT_API_BASE = 'http://localhost:8000/api';
const DEFAULT_WS_BASE = 'ws://localhost:8000';

const stripSlash = (s) => String(s || '').replace(/\/+$/, '');

export const getApiBase = () => {
  const saved = localStorage.getItem('qa_api_base');
  return stripSlash(saved || DEFAULT_API_BASE);
};

export const setApiBase = (baseUrl) => {
  const normalized = stripSlash(baseUrl || DEFAULT_API_BASE);
  const apiBase = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  localStorage.setItem('qa_api_base', apiBase);
  api.defaults.baseURL = apiBase;
  return apiBase;
};

export const resetApiBase = () => {
  localStorage.removeItem('qa_api_base');
  api.defaults.baseURL = DEFAULT_API_BASE;
  return DEFAULT_API_BASE;
};

const wsBaseFromApi = () => getApiBase().replace(/^http/i, 'ws').replace(/\/api$/, '');

const api = axios.create({ baseURL: getApiBase(), timeout: 35000 });

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const normalizeError = (error) => {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail || error?.response?.data?.error || error?.message || 'Unknown error';
  const e = new Error(status ? `HTTP ${status}: ${detail}` : detail);
  e.status = status;
  e.payload = error?.response?.data;
  return e;
};

async function request(fn, { retries = 1 } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await fn(); }
    catch (error) {
      last = error;
      const status = error?.response?.status;
      if (attempt >= retries || (status && status < 500)) break;
      await sleep(500 * (attempt + 1));
    }
  }
  throw normalizeError(last);
}

// ── Market ─────────────────────────────────────────────────────────────────

export const DEFAULT_SYMBOLS = 'BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT';

export const getTickers = async (symbols = DEFAULT_SYMBOLS) =>
  request(async () => {
    const res = (await api.get('/market/tickers', { params: { symbols } })).data;
    return Array.isArray(res) ? res : (res?.data ?? []);
  }, { retries: 2 });

export const getHistory = async (symbol, interval = '1h', limit = 100) => {
  const sym = String(symbol || 'BTC/USDT').replace('/', '_');
  return request(async () => (await api.get('/market/history', { params: { symbol: sym, interval, limit } })).data, { retries: 2 });
};

export const getSignal = async (symbol, timeframe = '1h') => {
  const sym = String(symbol || 'BTC/USDT').replace('/', '_');
  return request(async () => (await api.get(`/market/signal/${encodeURIComponent(sym)}`, { params: { timeframe } })).data, { retries: 2 });
};

// ── Kronos Forecast ─────────────────────────────────────────────────────────
export const getPrediction = async (symbol, timeframe = '1h', predLen = 24) => {
  const sym = String(symbol || 'BTC/USDT').replace('/', '_');
  return request(async () => (await api.get(`/predict/${encodeURIComponent(sym)}`, { params: { timeframe, pred_len: predLen } })).data);
};

// ── Swarm ───────────────────────────────────────────────────────────────────
export const runSwarm = async (symbol) =>
  request(async () => (await api.post('/swarm/run', { symbol })).data);

// ── Backtesting ──────────────────────────────────────────────────────────────
export const runBacktest = async (symbol) =>
  request(async () => (await api.get('/backtest/run', { params: { symbol } })).data);

// ── OpenTrader Strategy Engine ───────────────────────────────────────────────
export const getOpenTraderStatus = async () =>
  request(async () => (await api.get('/opentrader/status')).data, { retries: 1 });

export const runOpenTraderStrategy = async (strategy, symbol, params, paper = true) =>
  request(async () => (await api.post('/opentrader/strategy', { strategy, symbol, params, paper })).data);

export const runOpenTraderBacktest = async (strategy, symbol, timeframe, from_date, to_date, params = {}) =>
  request(async () => (await api.post('/opentrader/backtest', { strategy, symbol, timeframe, from_date, to_date, params })).data);

// ── News ─────────────────────────────────────────────────────────────────────
export const getNews = async (symbols = 'BTC,ETH,crypto', limit = 20) =>
  request(async () => {
    const res = (await api.get('/news', { params: { symbols, limit } })).data;
    return Array.isArray(res) ? res : (res?.data ?? []);
  }, { retries: 1 });

export const getSymbolNews = async (symbol, limit = 10) => {
  const sym = String(symbol || 'BTC').replace('/USDT', '').replace('/USD', '').replace('/', '');
  return request(async () => {
    const res = (await api.get(`/news/${encodeURIComponent(sym)}`, { params: { limit } })).data;
    return Array.isArray(res) ? res : (res?.data ?? []);
  });
};

// ── Portfolio / Bots ─────────────────────────────────────────────────────────
export const getPortfolio = async () => request(async () => (await api.get('/portfolio')).data, { retries: 1 });
export const getBots = async () => request(async () => (await api.get('/bots')).data, { retries: 1 });
export const toggleBot = async (id) => request(async () => (await api.post(`/bots/${id}/toggle`)).data);

// ── Config / Stats ───────────────────────────────────────────────────────────
export const getConfig = async () => request(async () => (await api.get('/config')).data, { retries: 1 });
export const updateConfig = async (cfg) => request(async () => (await api.post('/config', cfg)).data);
export const getSystemStats = async () => request(async () => (await api.get('/system/stats')).data, { retries: 1 });

// ── Agent chat ───────────────────────────────────────────────────────────────
export const chatWithAgent = async (message) =>
  request(async () => (await api.post('/agent/chat', { message })).data);

// ── WebSockets ───────────────────────────────────────────────────────────────
export const createMarketWS = () => new WebSocket(`${wsBaseFromApi()}/ws/market`);
export const createLogsWS = () => new WebSocket(`${wsBaseFromApi()}/ws/logs`);

// ── v3.3 Research / Risk / Validation Lab ───────────────────────────────────
export const getMarketDecision = async (symbol, timeframes = '15m,1h,4h,1d') => {
  const sym = String(symbol || 'BTC/USDT').replace('/', '_');
  return request(async () => (await api.get(`/market/decision/${encodeURIComponent(sym)}`, { params: { timeframes } })).data, { retries: 1 });
};

export const getResearchStatus = async () =>
  request(async () => (await api.get('/research/status')).data, { retries: 1 });

export const getResearchBriefing = async (query = 'crypto stocks', limit = 12) =>
  request(async () => (await api.get('/research/briefing', { params: { query, limit } })).data, { retries: 1 });

export const readResearchUrl = async (url) =>
  request(async () => (await api.get('/research/read', { params: { url } })).data, { retries: 0 });

export const inspectGithubRepo = async (repo = 'HKUDS/Vibe-Trading') =>
  request(async () => (await api.get('/research/github', { params: { repo } })).data, { retries: 1 });

export const getCorrelation = async (symbols = DEFAULT_SYMBOLS, interval = '1d', lookback = 120) =>
  request(async () => (await api.get('/portfolio/correlation', { params: { symbols, interval, lookback } })).data, { retries: 1 });

export const getPositionSize = async (symbol, interval = '1h', account_equity = 10000, risk_pct = 1, atr_mult = 2, max_alloc_pct = 25) =>
  request(async () => (await api.get('/risk/position-size', { params: { symbol, interval, account_equity, risk_pct, atr_mult, max_alloc_pct } })).data, { retries: 1 });

export const validateBacktest = async (symbol, strategy = 'rsi', interval = '1h', limit = 1000, folds = 4) =>
  request(async () => (await api.get('/backtest/validate', { params: { symbol, strategy, interval, limit, folds } })).data, { retries: 1 });

export const runAdvancedBacktest = async (symbol, strategy = 'rsi', interval = '1h', limit = 700, options = {}) =>
  request(async () => (await api.get('/backtest/run', { params: { symbol, strategy, interval, limit, ...options } })).data, { retries: 1 });
