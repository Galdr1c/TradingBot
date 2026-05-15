import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard, BarChart3, Wallet, Bot, BrainCircuit, Newspaper, Users,
  Database, GitBranch, Radio, Search, ShieldCheck, Settings as SettingsIcon,
  Save, RotateCcw
} from 'lucide-react';
import './App.css';
import * as api from './api';
import { ToastProvider, ErrorBoundary, useToast } from './components/AppShellUtils';

import Dashboard from './pages/Dashboard';
import Charts from './pages/Charts';
import Portfolio from './pages/Portfolio';
import Bots from './pages/Bots';
import Kronos from './pages/Kronos';
import News from './pages/News';
import Swarm from './pages/Swarm';
import Strategies from './pages/Strategies';
import Research from './pages/Research';
import RiskLab from './pages/RiskLab';

const NAV = [
  { id: 'dash', label: 'Dashboard', short: 'DASH', icon: LayoutDashboard, desc: 'Portföy, piyasa ve sistem özeti' },
  { id: 'charts', label: 'Charts', short: 'CHART', icon: BarChart3, desc: 'Teknik analiz ve mum formasyonları' },
  { id: 'portfolio', label: 'Portfolio', short: 'PORT', icon: Wallet, desc: 'Pozisyonlar ve getiri takibi' },
  { id: 'bots', label: 'Bots', short: 'BOTS', icon: Bot, desc: 'Bot performansı ve kontrol paneli' },
  { id: 'kronos', label: 'Kronos AI', short: 'AI', icon: BrainCircuit, desc: 'Zero-shot fiyat tahminleri' },
  { id: 'swarm', label: 'Swarm', short: 'SWARM', icon: Users, desc: 'Çok ajanlı karar motoru' },
  { id: 'strategies', label: 'Strategies', short: 'STRAT', icon: GitBranch, desc: 'GRID, DCA ve RSI stratejileri' },
  { id: 'news', label: 'News', short: 'NEWS', icon: Newspaper, desc: 'Piyasa haberleri ve duyarlılık' },
  { id: 'research', label: 'Research', short: 'R&D', icon: Search, desc: 'Repo, haber, URL ve araştırma otomasyonu' },
  { id: 'risklab', label: 'Risk Lab', short: 'RISK', icon: ShieldCheck, desc: 'Korelasyon, pozisyon boyutu ve walk-forward doğrulama' },
];

const PAGE_META = [
  ...NAV,
  { id: 'settings', label: 'Settings', short: 'SET', icon: SettingsIcon, desc: 'Bağlantılar, model ve veri kaynakları' },
];

function MarketRail({ tickers }) {
  const items = Array.isArray(tickers) ? tickers : [];
  return (
    <div className="ticker-wrap" aria-label="Market ticker">
      {items.length ? (
        <div className="ticker-inner">
          {[...items, ...items].map((t, i) => (
            <span key={`${t.symbol}-${i}`} className="ticker-item">
              <span className="ticker-symbol">{t.symbol}</span>
              <span className="ticker-price">${Number(t.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              <span className={Number(t.change || 0) >= 0 ? 'ticker-change up' : 'ticker-change down'}>
                {Number(t.change || 0) >= 0 ? '▲' : '▼'} {Math.abs(Number(t.change || 0)).toFixed(2)}%
              </span>
              {t.source && <span className="ticker-source">{t.source}</span>}
            </span>
          ))}
        </div>
      ) : <div className="ticker-empty">Canlı piyasa verisi bekleniyor — mock/demo fiyat gösterilmiyor.</div>}
    </div>
  );
}

export default function App() {
  return <ToastProvider><AppCore /></ToastProvider>;
}

function AppCore() {
  const { notify } = useToast();
  const [page, setPage] = useState('dash');
  const [tickers, setTickers] = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [logs, setLogs] = useState([
    { t: '--:--:--', tp: 'ok', m: '[System] QuantumAI Trading Engine v3.4 live-data-only starting...' },
    { t: '--:--:--', tp: 'info', m: '[Data] Connecting to real market feeds...' },
  ]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const [search, setSearch] = useState('');
  const [focusSymbol, setFocusSymbol] = useState('BTC/USDT');
  const logsEndRef = useRef(null);
  const wsRef = useRef(null);
  const logsWsRef = useRef(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const pushLog = useCallback((tp, m) => {
    setLogs(prev => [...prev.slice(-199), { t: new Date().toLocaleTimeString(), tp, m }]);
  }, []);

  const connectMarketWs = useCallback(() => {
    try {
      const ws = api.createMarketWS();
      wsRef.current = ws;
      ws.onopen = () => { setWsStatus('live'); pushLog('ok', '[WS] Market stream connected'); };
      ws.onclose = () => { setWsStatus('reconnecting'); setTimeout(connectMarketWs, 4000); };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'tickers' && Array.isArray(msg.data)) setTickers(msg.data);
        } catch {}
      };
    } catch (e) {
      setWsStatus('http');
      pushLog('warn', `[WS] Market socket unavailable: ${e.message}`);
    }
  }, [pushLog]);

  const connectLogsWs = useCallback(() => {
    try {
      const ws = api.createLogsWS();
      logsWsRef.current = ws;
      ws.onclose = () => setTimeout(connectLogsWs, 6000);
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        try { setLogs(prev => [...prev.slice(-199), JSON.parse(e.data)]); } catch {}
      };
    } catch (e) {
      pushLog('warn', `[WS] Log socket unavailable: ${e.message}`);
    }
  }, [pushLog]);

  const fetchTickers = useCallback(async () => {
    try {
      setTickers(await api.getTickers());
      if (wsStatus !== 'live') setWsStatus('http');
    } catch (e) {
      setWsStatus('offline');
      pushLog('err', `[Ticker] ${e.message}`);
    }
  }, [pushLog, wsStatus]);

  const fetchPortfolio = useCallback(async () => {
    try { setPortfolio(await api.getPortfolio()); }
    catch (e) { pushLog('warn', `[Portfolio] ${e.message}`); }
  }, [pushLog]);

  useEffect(() => {
    connectMarketWs();
    connectLogsWs();
    fetchTickers();
    fetchPortfolio();
    const t1 = setInterval(fetchTickers, 10000);
    const t2 = setInterval(fetchPortfolio, 30000);
    return () => { clearInterval(t1); clearInterval(t2); wsRef.current?.close(); logsWsRef.current?.close(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active = PAGE_META.find(x => x.id === page) || PAGE_META[0];
  const dateStr = new Date().toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
  const statusLabel = wsStatus === 'live' ? 'Live WebSocket' : wsStatus === 'http' ? 'Live HTTP' : wsStatus === 'reconnecting' ? 'Yeniden bağlanıyor' : wsStatus === 'offline' ? 'Offline' : 'Bağlanıyor';

  const onSearchSubmit = (e) => {
    e.preventDefault();
    const raw = search.trim().toUpperCase();
    if (!raw) return;
    const normalized = raw.includes('/') ? raw : ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(raw) ? `${raw}/USDT` : raw;
    setFocusSymbol(normalized);
    setSearch('');
    setPage('charts');
    notify(`${normalized} grafik ekranında açıldı`, 'success');
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-mark"><Database size={18} /></div>
          <div>
            <div className="brand-title">Quantum AI</div>
            <div className="brand-sub">Trading Studio v3.4</div>
          </div>
        </div>

        <nav className="nav-stack" aria-label="Ana menü">
          {NAV.map(({ id, label, short, icon: Icon }) => (
            <button key={id} type="button" className={`nb ${page === id ? 'act' : ''}`} onClick={() => setPage(id)} title={label}>
              <Icon size={18} />
              <span className="nbl">{label}</span>
              <span className="nav-short">{short}</span>
            </button>
          ))}
        </nav>

        <button type="button" className={`nb settings-link ${page === 'settings' ? 'act' : ''}`} title="Settings" onClick={() => setPage('settings')}>
          <SettingsIcon size={18} />
          <span className="nbl">Settings</span>
          <span className="nav-short">SET</span>
        </button>
      </aside>

      <div className="content">
        <header className="titlebar">
          <div className="page-heading">
            <div className="eyebrow"><ShieldCheck size={13} /> AI-assisted trading terminal</div>
            <h1>{active.label}</h1>
            <p>{active.desc}</p>
          </div>

          <div className="top-actions">
            <form className="search-shell" onSubmit={onSearchSubmit}>
              <Search size={14} />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="BTC, ETH, AAPL, MSFT ara..." aria-label="Sembol ara" />
            </form>
            <div className={`status-pill ${wsStatus}`}>
              <span className="live-dot" />
              <Radio size={13} />
              {statusLabel}
            </div>
            <div className="date-pill">{dateStr}</div>
          </div>
        </header>

        <MarketRail tickers={tickers} />

        <main className="page">
          <ErrorBoundary resetKey={page}>
            {page === 'dash' && <Dashboard tickers={tickers} logs={logs} portfolio={portfolio} focusSymbol={focusSymbol} />}
            {page === 'charts' && <Charts externalSymbol={focusSymbol} />}
            {page === 'portfolio' && <Portfolio />}
            {page === 'bots' && <Bots />}
            {page === 'kronos' && <Kronos externalSymbol={focusSymbol} />}
            {page === 'swarm' && <Swarm />}
            {page === 'strategies' && <Strategies />}
            {page === 'news' && <News />}
            {page === 'research' && <Research />}
            {page === 'risklab' && <RiskLab />}
            {page === 'settings' && <SettingsPage onSaved={() => { fetchTickers(); fetchPortfolio(); }} />}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

function SettingsPage({ onSaved }) {
  const { notify } = useToast();
  const [apiUrl, setApiUrl] = useState(api.getApiBase());
  const [otStatus, setOtStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ot, cfg] = await Promise.all([api.getOpenTraderStatus(), api.getConfig()]);
      setOtStatus(ot); setConfig(cfg);
    } catch (e) { notify(`Ayarlar yüklenemedi: ${e.message}`, 'error'); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const saveApi = async () => {
    setSaving(true);
    try {
      const saved = api.setApiBase(apiUrl);
      setApiUrl(saved);
      notify('API adresi kaydedildi', 'success');
      await load();
      onSaved?.();
    } catch (e) { notify(`Kaydetme hatası: ${e.message}`, 'error'); }
    setSaving(false);
  };

  const resetApi = async () => {
    const saved = api.resetApiBase();
    setApiUrl(saved);
    notify('API adresi varsayılana döndü', 'success');
    await load();
    onSaved?.();
  };

  return (
    <div className="col fade-in settings-grid">
      <div className="panel">
        <div className="ph"><span className="ac">■</span> BACKEND CONFIGURATION</div>
        <div className="panel-pad stack-12">
          <div>
            <div className="field-label">API Base URL</div>
            <input className="input" value={apiUrl} onChange={e => setApiUrl(e.target.value)} placeholder="http://localhost:8000/api" />
          </div>
          <div className="action-row">
            <button className="btn" type="button" onClick={saveApi} disabled={saving}><Save size={13} /> {saving ? 'Kaydediliyor...' : 'Kaydet ve test et'}</button>
            <button className="btn ghost" type="button" onClick={resetApi}><RotateCcw size={13} /> Varsayılan</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="ag">■</span> OPENTRADER STATUS</div>
        <div className="panel-pad">
          {otStatus ? (
            <>
              <div className="status-row">
                <div className={otStatus.available ? 'status-dot ok' : 'status-dot warn'} />
                <span>{otStatus.available ? `Live on port ${otStatus.port}` : 'OpenTrader bağlı değil — bot işlemleri devre dışı'}</span>
              </div>
              <div className="code-card">npm install -g opentrader<br />opentrader set-password &lt;password&gt;<br />opentrader up --port {otStatus.port}</div>
            </>
          ) : <div className="loading-cell">Status kontrol ediliyor...</div>}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="ag">■</span> KRONOS MODEL</div>
        <div className="panel-pad kv-list">
          {[
            ['Model', 'NeoQuasar/Kronos-small'], ['Tokenizer', 'NeoQuasar/Kronos-Tokenizer-base'],
            ['Max Context', '512 tokens'], ['Device', 'CPU / CUDA auto'], ['LLM', config?.DEFAULT_LLM || 'ollama'],
          ].map(([l, v]) => <div key={l} className="kv-row"><span>{l}</span><strong>{v}</strong></div>)}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="aa">■</span> DATA SOURCES</div>
        <div className="panel-pad source-list">
          {[
            ['Binance', 'Live crypto OHLCV + ticker'], ['Yahoo Finance', 'Real equity/ETF OHLCV + quote'],
            ['SQLite WAL Cache', 'Only real provider data; optional recovery disabled by default'], ['Mock/Demo', 'Disabled — unavailable providers show errors instead'],
          ].map(([name, detail]) => <div className="source-item" key={name}><strong>{name}</strong><span>{detail}</span></div>)}
        </div>
      </div>
    </div>
  );
}
