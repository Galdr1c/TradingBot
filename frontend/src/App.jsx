import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  LayoutDashboard, BarChart3, Wallet, Bot,
  BrainCircuit, Newspaper, Users, Settings, Database,
  Minus, Square, X
} from 'lucide-react';
import './App.css';
import * as api from './api';

const ipcRenderer = window.require ? window.require('electron').ipcRenderer : null;

import Dashboard  from './pages/Dashboard';
import Charts     from './pages/Charts';
import Portfolio  from './pages/Portfolio';
import Bots       from './pages/Bots';
import Kronos     from './pages/Kronos';
import News       from './pages/News';
import Swarm      from './pages/Swarm';

/* ── Sidebar nav config ─────────────────────────────────────────── */
const NAV = [
  { id:'dash',      label:'DASH',    icon:LayoutDashboard },
  { id:'charts',    label:'CHART',   icon:BarChart3 },
  { id:'portfolio', label:'PORT',    icon:Wallet },
  { id:'bots',      label:'BOTS',    icon:Bot },
  { id:'kronos',    label:'AI',      icon:BrainCircuit },
  { id:'swarm',     label:'SWARM',   icon:Users },
  { id:'news',      label:'NEWS',    icon:Newspaper },
];

/* ── Main App ───────────────────────────────────────────────────── */
export default function App() {
  const [page, setPage]         = useState('dash');
  const [tickers, setTickers]   = useState([]);
  const [portfolio, setPortfolio] = useState(null);
  const [logs, setLogs]         = useState([
    { t:'--:--:--', tp:'ok',   m:'[System] QuantumAI Trading Engine v2.0 starting...' },
    { t:'--:--:--', tp:'info', m:'[Data]   Connecting to market feeds...' },
  ]);
  const [wsStatus, setWsStatus] = useState('connecting');
  const logsEndRef = useRef(null);
  const wsRef      = useRef(null);
  const logsWsRef  = useRef(null);

  /* Auto-scroll logs */
  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior:'smooth' }); }, [logs]);

  /* ── WebSocket: market tickers ─────────────────────────────── */
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

  /* ── WebSocket: logs ───────────────────────────────────────── */
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

  /* ── HTTP fallback for tickers ─────────────────────────────── */
  const fetchTickers = useCallback(async () => {
    try {
      const data = await api.getTickers();
      setTickers(data);
      setWsStatus('http');
    } catch(e) {
      setLogs(l => [...l, { t: new Date().toLocaleTimeString(), tp:'err', m:`[Error] Market feed: ${e.message}` }]);
    }
  }, []);

  /* ── Portfolio polling ─────────────────────────────────────── */
  const fetchPortfolio = useCallback(async () => {
    try { setPortfolio(await api.getPortfolio()); } catch {}
  }, []);

  /* ── Bootstrap ─────────────────────────────────────────────── */
  useEffect(() => {
    connectMarketWs();
    connectLogsWs();
    fetchTickers();
    fetchPortfolio();

    // Fallback polling when WS not available
    const tickerInterval = setInterval(fetchTickers, 8000);
    const portInterval   = setInterval(fetchPortfolio, 30000);

    return () => {
      clearInterval(tickerInterval);
      clearInterval(portInterval);
      wsRef.current?.close();
      logsWsRef.current?.close();
    };
  }, [connectMarketWs, connectLogsWs, fetchTickers, fetchPortfolio]);

  /* ── Current date string ───────────────────────────────────── */
  const dateStr = new Date().toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }).toUpperCase();

  return (
    <div className="app">
      {/* ── Titlebar ─────────────────────────────────────────── */}
      <div className="titlebar">
        <div style={{ display:'flex', alignItems:'center', gap:10, WebkitAppRegion:'no-drag', width:200 }}>
          <div style={{ width:24, height:24, borderRadius:6, background:'linear-gradient(135deg, var(--cyan), var(--purple))', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:'0 0 10px rgba(56,189,248,0.5)' }}>
            <Database size={13} color="#fff" />
          </div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:12, fontWeight:700, letterSpacing:1.5, color:'var(--text-bright)' }}>QUANTUM AI</div>
        </div>

        <div className="tb-title">VIBE-TRADING · v2.0</div>

        <div className="tb-right" style={{ width:280, justifyContent:'flex-end', gap:0 }}>
          <div className="sb-ind" style={{ marginRight:16 }}>
            <span className="live-dot" />
            {wsStatus === 'live' ? 'LIVE WS' : wsStatus === 'http' ? 'LIVE HTTP' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
          </div>
          <span style={{ marginRight:20 }}>{dateStr}</span>

          {/* Windows Controls */}
          <div style={{ display:'flex', alignItems:'center', height:'100%', WebkitAppRegion:'no-drag', marginRight:-16 }}>
            <button className="win-btn" onClick={() => ipcRenderer?.send('window-min')}><Minus size={14} /></button>
            <button className="win-btn" onClick={() => ipcRenderer?.send('window-max')}><Square size={11} /></button>
            <button className="win-btn close" onClick={() => ipcRenderer?.send('window-close')}><X size={15} /></button>
          </div>
        </div>
      </div>

      <div className="body">
        {/* ── Sidebar ───────────────────────────────────────── */}
        <div className="sidebar">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nb ${page===id?'act':''}`} onClick={() => setPage(id)} title={label}>
              <Icon size={18} />
              <span className="nbl">{label}</span>
            </button>
          ))}
          <div style={{ flex:1 }} />
          <button className="nb" title="SETTINGS" onClick={() => setPage('settings')}>
            <Settings size={18} />
            <span className="nbl">SET</span>
          </button>
        </div>

        {/* ── Content ──────────────────────────────────────── */}
        <div className="content">
          {/* Ticker Strip */}
          <div className="ticker-wrap">
            <div className="ticker-inner">
              {[...tickers, ...tickers].map((t, i) => (
                <span key={i} style={{ marginRight:28, fontSize:9.5, display:'inline-flex', alignItems:'center', gap:6 }}>
                  <span style={{ color:'var(--text2)', letterSpacing:.5 }}>{t.symbol}</span>
                  <span style={{ color:'var(--text3)', fontFamily:'Orbitron,sans-serif', fontSize:9 }}>
                    ${t.price?.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
                  </span>
                  <span style={{ color: t.change>=0?'var(--green)':'var(--red)', fontWeight:700 }}>
                    {t.change>=0?'▲':'▼'}{Math.abs(t.change||0).toFixed(2)}%
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Page Content */}
          <div className="page">
            {page === 'dash'      && <Dashboard  tickers={tickers} logs={logs} portfolio={portfolio} />}
            {page === 'charts'    && <Charts />}
            {page === 'portfolio' && <Portfolio />}
            {page === 'bots'      && <Bots />}
            {page === 'kronos'    && <Kronos />}
            {page === 'swarm'     && <Swarm />}
            {page === 'news'      && <News />}
            {page === 'settings'  && <SettingsPage />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Settings Page (inline) ─────────────────────────────────────── */
function SettingsPage() {
  const [apiUrl, setApiUrl] = useState('http://localhost:8000');
  return (
    <div className="col fade-in" style={{ gap:10, maxWidth:600 }}>
      <div className="panel">
        <div className="ph"><span className="ac">■</span> BACKEND CONFIGURATION</div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:12 }}>
          {[
            { label:'API Base URL', val:apiUrl, set:setApiUrl, placeholder:'http://localhost:8000' },
          ].map(f => (
            <div key={f.label}>
              <div style={{ fontSize:8.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:5 }}>{f.label}</div>
              <input value={f.val} onChange={e=>f.set(e.target.value)} placeholder={f.placeholder}
                style={{ width:'100%', background:'var(--panel2)', border:'1px solid var(--border2)', color:'var(--text3)', fontFamily:'JetBrains Mono,monospace', fontSize:10, padding:'7px 10px', borderRadius:3, outline:'none' }} />
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="ag">■</span> KRONOS MODEL</div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:8 }}>
          {[
            { label:'Model Name', val:'NeoQuasar/Kronos-small' },
            { label:'Tokenizer', val:'NeoQuasar/Kronos-Tokenizer-base' },
            { label:'Max Context', val:'512 tokens' },
            { label:'Device', val:'CPU / CUDA auto-detect' },
            { label:'Paper', val:'AAAI 2026 — arxiv:2508.02739' },
          ].map(r => (
            <div key={r.label} style={{ display:'flex', justifyContent:'space-between', fontSize:10, padding:'6px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--text2)' }}>{r.label}</span>
              <span style={{ color:'var(--cyan)', fontFamily:'Orbitron,sans-serif', fontSize:9 }}>{r.val}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="aa">■</span> DATA SOURCES</div>
        <div style={{ padding:16, display:'flex', flexDirection:'column', gap:8 }}>
          {[
            { name:'Binance', status:'CONNECTED', color:'var(--green)', desc:'Crypto OHLCV, real-time tickers via CCXT' },
            { name:'Yahoo Finance', status:'CONNECTED', color:'var(--green)', desc:'Equity data via yfinance' },
            { name:'Agent-Reach RSS', status:'ACTIVE', color:'var(--cyan)', desc:'News aggregation from CoinTelegraph, Decrypt, CNBC' },
            { name:'Vibe-Trading API', status:'READY', color:'var(--orange)', desc:'Swarm analysis engine' },
          ].map(s => (
            <div key={s.name} style={{ display:'flex', alignItems:'center', gap:12, padding:'8px 0', borderBottom:'1px solid var(--border)' }}>
              <div style={{ width:7, height:7, borderRadius:'50%', background:s.color, boxShadow:`0 0 6px ${s.color}`, flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div style={{ fontSize:10, color:'var(--text3)', fontWeight:600 }}>{s.name}</div>
                <div style={{ fontSize:8.5, color:'var(--text2)', marginTop:2 }}>{s.desc}</div>
              </div>
              <span className="tag" style={{ color:s.color, background:'rgba(255,255,255,0.04)', border:`1px solid ${s.color}30` }}>{s.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
