import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard, BarChart3, Wallet, Bot,
  BrainCircuit, Newspaper, Users, Settings,
  Database, GitBranch, Radio, Search, ShieldCheck
} from 'lucide-react';
import './App.css';
import * as api from './api';

import Dashboard  from './pages/Dashboard';
import Charts     from './pages/Charts';
import Portfolio  from './pages/Portfolio';
import Bots       from './pages/Bots';
import Kronos     from './pages/Kronos';
import News       from './pages/News';
import Swarm      from './pages/Swarm';
import Strategies from './pages/Strategies';

const NAV = [
  { id:'dash',       label:'Dashboard',  short:'DASH',  icon:LayoutDashboard, desc:'Portföy, piyasa ve sistem özeti' },
  { id:'charts',     label:'Charts',     short:'CHART', icon:BarChart3,       desc:'Teknik analiz ve mum formasyonları' },
  { id:'portfolio',  label:'Portfolio',  short:'PORT',  icon:Wallet,          desc:'Pozisyonlar ve getiri takibi' },
  { id:'bots',       label:'Bots',       short:'BOTS',  icon:Bot,             desc:'Bot performansı ve kontrol paneli' },
  { id:'kronos',     label:'Kronos AI',  short:'AI',    icon:BrainCircuit,    desc:'Zero-shot fiyat tahminleri' },
  { id:'swarm',      label:'Swarm',      short:'SWARM', icon:Users,           desc:'Çok ajanlı karar motoru' },
  { id:'strategies', label:'Strategies', short:'STRAT', icon:GitBranch,       desc:'GRID, DCA ve RSI stratejileri' },
  { id:'news',       label:'News',       short:'NEWS',  icon:Newspaper,       desc:'Piyasa haberleri ve duyarlılık' },
];

const PAGE_META = [
  ...NAV,
  { id:'settings', label:'Settings', short:'SET', icon:Settings, desc:'Bağlantılar, model ve veri kaynakları' },
];

function MarketRail({ tickers }) {
  const items = tickers?.length ? tickers : [
    { symbol:'BTC/USDT', price:0, change:0 },
    { symbol:'ETH/USDT', price:0, change:0 },
    { symbol:'AAPL', price:0, change:0 },
  ];

  return (
    <div className="ticker-wrap" aria-label="Market ticker">
      <div className="ticker-inner">
        {[...items, ...items].map((t, i) => (
          <span key={`${t.symbol}-${i}`} className="ticker-item">
            <span className="ticker-symbol">{t.symbol}</span>
            <span className="ticker-price">
              ${Number(t.price || 0).toLocaleString('en-US', { minimumFractionDigits:2, maximumFractionDigits:2 })}
            </span>
            <span className={t.change >= 0 ? 'ticker-change up' : 'ticker-change down'}>
              {t.change >= 0 ? '▲' : '▼'} {Math.abs(t.change || 0).toFixed(2)}%
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage]           = useState('dash');
  const [tickers, setTickers]     = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [logs, setLogs]           = useState([
    { t:'--:--:--', tp:'ok',   m:'[System] QuantumAI Trading Engine v3.1 starting...' },
    { t:'--:--:--', tp:'info', m:'[Data]   Connecting to market feeds...' },
  ]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const logsEndRef = useRef(null);
  const wsRef      = useRef(null);
  const logsWsRef  = useRef(null);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [logs]);

  const connectMarketWs = useCallback(() => {
    const ws = api.createMarketWS();
    wsRef.current = ws;
    ws.onopen  = () => setWsStatus('live');
    ws.onclose = () => { setWsStatus('reconnecting'); setTimeout(connectMarketWs, 4000); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'tickers' && Array.isArray(msg.data)) setTickers(msg.data);
      } catch {}
    };
    return ws;
  }, []);

  const connectLogsWs = useCallback(() => {
    const ws = api.createLogsWS();
    logsWsRef.current = ws;
    ws.onclose = () => setTimeout(connectLogsWs, 6000);
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        setLogs(prev => [...prev.slice(-199), msg]);
      } catch {}
    };
    return ws;
  }, []);

  const fetchTickers = useCallback(async () => {
    try {
      setTickers(await api.getTickers());
      setWsStatus('http');
    } catch(e) {
      setLogs(l => [...l, { t: new Date().toLocaleTimeString(), tp:'err', m:`[Error] ${e.message}` }]);
    }
  }, []);

  const fetchPortfolio = useCallback(async () => {
    try { setPortfolio(await api.getPortfolio()); } catch {}
  }, []);

  useEffect(() => {
    connectMarketWs(); connectLogsWs(); fetchTickers(); fetchPortfolio();
    const t1 = setInterval(fetchTickers, 8000);
    const t2 = setInterval(fetchPortfolio, 30000);
    return () => { clearInterval(t1); clearInterval(t2); wsRef.current?.close(); logsWsRef.current?.close(); };
  }, [connectMarketWs, connectLogsWs, fetchTickers, fetchPortfolio]);

  const active = PAGE_META.find(x => x.id === page) || PAGE_META[0];
  const dateStr = new Date().toLocaleDateString('tr-TR', { day:'2-digit', month:'long', year:'numeric' });
  const statusLabel = wsStatus === 'live' ? 'Live WebSocket' : wsStatus === 'http' ? 'Live HTTP' : wsStatus === 'reconnecting' ? 'Yeniden bağlanıyor' : 'Bağlanıyor';

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand-card">
          <div className="brand-mark"><Database size={18} /></div>
          <div>
            <div className="brand-title">Quantum AI</div>
            <div className="brand-sub">Trading Studio v3.1</div>
          </div>
        </div>

        <nav className="nav-stack">
          {NAV.map(({ id, label, short, icon: Icon }) => (
            <button key={id} className={`nb ${page===id?'act':''}`} onClick={() => setPage(id)} title={label}>
              <Icon size={18} />
              <span className="nbl">{label}</span>
              <span className="nav-short">{short}</span>
            </button>
          ))}
        </nav>

        <button className={`nb settings-link ${page==='settings'?'act':''}`} title="Settings" onClick={() => setPage('settings')}>
          <Settings size={18} />
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
            <div className="search-shell"><Search size={14} /><span>Sembol, strateji veya haber ara</span></div>
            <div className="status-pill">
              <span className="live-dot" />
              <Radio size={13} />
              {statusLabel}
            </div>
            <div className="date-pill">{dateStr}</div>
          </div>
        </header>

        <MarketRail tickers={tickers} />

        <main className="page">
          {page === 'dash'       && <Dashboard tickers={tickers} logs={logs} portfolio={portfolio} />}
          {page === 'charts'     && <Charts />}
          {page === 'portfolio'  && <Portfolio />}
          {page === 'bots'       && <Bots />}
          {page === 'kronos'     && <Kronos />}
          {page === 'swarm'      && <Swarm />}
          {page === 'strategies' && <Strategies />}
          {page === 'news'       && <News />}
          {page === 'settings'   && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [apiUrl, setApiUrl] = useState('http://localhost:8000');
  const [otStatus, setOtStatus] = useState(null);

  useEffect(() => {
    api.getOpenTraderStatus().then(setOtStatus).catch(() => {});
  }, []);

  return (
    <div className="col fade-in settings-grid">
      <div className="panel">
        <div className="ph"><span className="ac">■</span> BACKEND CONFIGURATION</div>
        <div className="panel-pad">
          <div>
            <div className="field-label">API Base URL</div>
            <input className="input" value={apiUrl} onChange={e=>setApiUrl(e.target.value)} />
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
                <span>{otStatus.available ? `Live on port ${otStatus.port}` : 'Simulation mode — live işlem için OpenTrader kurulu olmalı'}</span>
              </div>
              <div className="code-card">
                # Install OpenTrader (requires Node.js ≥ 22)<br/>
                npm install -g opentrader<br/>
                opentrader set-password &lt;password&gt;<br/>
                opentrader up --port {otStatus.port}
              </div>
            </>
          ) : (
            <div className="loading-cell">Loading status...</div>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="ag">■</span> KRONOS MODEL</div>
        <div className="panel-pad kv-list">
          {[['Model','NeoQuasar/Kronos-small'],['Tokenizer','NeoQuasar/Kronos-Tokenizer-base'],['Max Context','512 tokens'],['Device','CPU / CUDA auto'],['Paper','AAAI 2026 — arxiv:2508.02739']].map(([l,v]) => (
            <div key={l} className="kv-row"><span>{l}</span><strong>{v}</strong></div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="aa">■</span> DATA SOURCES</div>
        <div className="panel-pad source-list">
          {[
            {name:'Binance',          status:'CONNECTED', color:'var(--green)',  desc:'Crypto OHLCV + real-time tickers via CCXT'},
            {name:'Yahoo Finance',    status:'CONNECTED', color:'var(--green)',  desc:'Equity data via yfinance'},
            {name:'Agent-Reach RSS',  status:'ACTIVE',    color:'var(--cyan)',   desc:'CoinTelegraph, Decrypt, CNBC haber akışı'},
            {name:'OpenTrader CLI',   status:'READY',     color:'var(--orange)', desc:'GRID · DCA · RSI strateji köprüsü'},
            {name:'Kronos Predictor', status:'LOADED',    color:'var(--purple)', desc:'Zero-shot forecaster'},
          ].map(s => (
            <div key={s.name} className="source-row">
              <div className="source-dot" style={{ background:s.color, boxShadow:`0 0 14px ${s.color}` }} />
              <div>
                <div className="source-name">{s.name}</div>
                <div className="source-desc">{s.desc}</div>
              </div>
              <span className="tag" style={{ color:s.color, borderColor:`${s.color}55` }}>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
