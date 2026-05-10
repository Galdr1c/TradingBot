import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Activity, 
  Bot, 
  BrainCircuit, 
  Newspaper, 
  Settings, 
  Terminal, 
  BarChart3,
  TrendingUp,
  TrendingDown,
  LayoutDashboard,
  Cpu,
  Database
} from 'lucide-react';
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer 
} from 'recharts';
import './App.css';
import * as api from './api';

/* ═══════════════════════════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

const NavItem = ({ id, active, label, icon: Icon, onClick }) => (
  <button className={`nb ${active === id ? 'act' : ''}`} onClick={() => onClick(id)}>
    <Icon size={20} />
    <span className="nbl">{label}</span>
  </button>
);

const MetricCard = ({ label, value, color, sub }) => (
  <div className="mc">
    <div className="ml">{label}</div>
    <div className="mv" style={{ color: color }}>{value}</div>
    <div style={{ fontSize: '8px', color: '#2a3f55', marginTop: '2px' }}>{sub}</div>
  </div>
);

/* ═══════════════════════════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════════════════════════ */

function App() {
  const [page, setPage] = useState('dash');
  const [tickers, setTickers] = useState([]);
  const [logs, setLogs] = useState([
    { t: '18:24:17', tp: 'ok', m: '[System] Connection established to backend.' },
    { t: '18:24:18', tp: 'info', m: '[Data] Loading market symbols...' },
  ]);

  // Fetch real-time data
  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await api.getTickers("BTC/USDT,ETH/USDT,SOL/USDT,AAPL,NVDA,TSLA");
        setTickers(data);
      } catch (err) {
        setLogs(l => [...l, { t: new Date().toLocaleTimeString(), tp: 'err', m: `[Error] Failed to fetch prices: ${err.message}` }]);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  const portVal = 128450.32;
  const dayPnl = 1240.45;

  return (
    <div className="app">
      {/* Titlebar */}
      <div className="titlebar">
        <div className="tl">
          <span className="tc"></span><span className="tm"></span><span className="tx"></span>
        </div>
        <div className="tb-title">QUANTUM AI · VIBE-TRADING</div>
        <div className="tb-right">
          <span className="sb-ind"><span className="live-dot"></span> LIVE</span>
          <span>MAY 10, 2026</span>
          <Database size={12} color="#00ccff" />
        </div>
      </div>

      <div className="body">
        {/* Sidebar */}
        <div className="sidebar">
          <NavItem id="dash" active={page} label="DASH" icon={LayoutDashboard} onClick={setPage} />
          <NavItem id="bots" active={page} label="BOTS" icon={Bot} onClick={setPage} />
          <NavItem id="kronos" active={page} label="KRONOS" icon={BrainCircuit} onClick={setPage} />
          <NavItem id="news" active={page} label="NEWS" icon={Newspaper} onClick={setPage} />
          <div style={{ flex: 1 }}></div>
          <NavItem id="settings" active={page} label="SETUP" icon={Settings} onClick={setPage} />
        </div>

        {/* Content Area */}
        <div className="content">
          <div className="ticker-wrap">
            <div className="ticker-inner">
              {tickers.map(t => (
                <span key={t.symbol} style={{ marginRight: '24px', fontSize: '10px' }}>
                  <span style={{ color: '#5a7a95' }}>{t.symbol}</span>
                  <span style={{ marginLeft: '6px', color: '#c8dde8' }}>${t.price.toLocaleString()}</span>
                  <span style={{ marginLeft: '6px', color: t.change >= 0 ? '#00ff9f' : '#ff3366' }}>
                    {t.change >= 0 ? '▲' : '▼'}{Math.abs(t.change).toFixed(2)}%
                  </span>
                </span>
              ))}
            </div>
          </div>

          <div className="page" style={{ padding: '12px' }}>
            {page === 'dash' && (
              <div className="col" style={{ gap: '12px' }}>
                <div className="g4">
                  <MetricCard label="PORTFOLIO" value={`$${portVal.toLocaleString()}`} color="#00ccff" sub="Total Net Worth" />
                  <MetricCard label="DAY P&L" value={`+$${dayPnl.toLocaleString()}`} color="#00ff9f" sub="Realized + Unrealized" />
                  <MetricCard label="ACTIVE BOTS" value="4 / 6" color="#ffaa00" sub="Execution Active" />
                  <MetricCard label="MARKET BIAS" value="BULLISH" color="#00ff9f" sub="Sentiment Score: 78" />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '12px', height: '300px' }}>
                  <div className="panel">
                    <div className="ph"><span className="ac">■</span> MARKET OVERVIEW</div>
                    <div className="sc" style={{ flex: 1, padding: '12px' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                          <tr style={{ color: '#2a3f55', textAlign: 'left', borderBottom: '1px solid #1a2840' }}>
                            <th style={{ padding: '8px' }}>ASSET</th>
                            <th style={{ padding: '8px' }}>PRICE</th>
                            <th style={{ padding: '8px' }}>24H CHG</th>
                            <th style={{ padding: '8px' }}>CATEGORY</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tickers.map(t => (
                            <tr key={t.symbol} style={{ borderBottom: '1px solid #0f1a25' }}>
                              <td style={{ padding: '8px', fontWeight: 600 }}>{t.symbol}</td>
                              <td style={{ padding: '8px', color: '#c8dde8' }}>${t.price.toLocaleString()}</td>
                              <td style={{ padding: '8px', color: t.change >= 0 ? '#00ff9f' : '#ff3366' }}>
                                {t.change >= 0 ? '+' : ''}{t.change.toFixed(2)}%
                              </td>
                              <td style={{ padding: '8px', color: '#2a3f55' }}>{t.category.toUpperCase()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className="panel">
                    <div className="ph"><span className="ag">■</span> SYSTEM STATUS</div>
                    <div className="sc" style={{ flex: 1, padding: '12px' }}>
                      <div className="col" style={{ gap: '10px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                          <span>CPU LOAD</span>
                          <span style={{ color: '#00ff9f' }}>24%</span>
                        </div>
                        <div style={{ height: '2px', background: '#1a2840' }}>
                          <div style={{ width: '24%', height: '100%', background: '#00ff9f' }}></div>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                          <span>MEM USAGE</span>
                          <span style={{ color: '#00ccff' }}>1.2 GB</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                          <span>KRONOS INFERENCE</span>
                          <span style={{ color: '#ffaa00' }}>READY</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px' }}>
                          <span>AGENT-REACH</span>
                          <span style={{ color: '#00ff9f' }}>CONNECTED</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="panel" style={{ flex: 1, minHeight: '150px' }}>
                  <div className="ph"><span className="ac">■</span> REAL-TIME LOGS</div>
                  <div className="sc" style={{ flex: 1 }}>
                    {logs.map((l, i) => (
                      <div key={i} className="log-l">
                        <span className="ts">{l.t}</span>
                        <span className={`log-${l.tp}`}>{l.m}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {page === 'kronos' && (
              <div className="col" style={{ gap: '12px', height: '100%' }}>
                <div className="panel" style={{ flex: 1 }}>
                  <div className="ph">
                    <span className="ac">■</span> KRONOS FOUNDATION MODEL · ZERO-SHOT FORECASTING
                    <button className="btn sm" style={{ marginLeft: 'auto' }}>⚡ RE-CALIBRATE</button>
                  </div>
                  <div style={{ flex: 1, padding: '20px' }}>
                    <div style={{ display: 'flex', gap: '20px', height: '100%' }}>
                      <div className="col" style={{ width: '200px' }}>
                         <div style={{ fontSize: '9px', color: '#2a3f55', marginBottom: '8px' }}>MODEL PARAMETERS</div>
                         <div className="mc" style={{ marginBottom: '8px' }}>
                            <div className="ml">TEMP</div>
                            <div className="mv" style={{ fontSize: '12px' }}>0.7</div>
                         </div>
                         <div className="mc" style={{ marginBottom: '8px' }}>
                            <div className="ml">TOP_P</div>
                            <div className="mv" style={{ fontSize: '12px' }}>0.9</div>
                         </div>
                         <div className="mc">
                            <div className="ml">HORIZON</div>
                            <div className="mv" style={{ fontSize: '12px' }}>24 BARS</div>
                         </div>
                      </div>
                      <div className="panel" style={{ flex: 1, padding: '12px' }}>
                         <div style={{ fontSize: '12px', color: '#c8dde8', marginBottom: '12px' }}>BTC/USDT FORECAST BAND</div>
                         <ResponsiveContainer width="100%" height="80%">
                            <AreaChart data={Array.from({length: 24}, (_, i) => ({ t: i, p: 97000 + i*10, hi: 97500 + i*10, lo: 96500 + i*10 }))}>
                              <defs>
                                <linearGradient id="colorPv" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#00ccff" stopOpacity={0.3}/>
                                  <stop offset="95%" stopColor="#00ccff" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <XAxis dataKey="t" hide />
                              <YAxis domain={['auto', 'auto']} hide />
                              <Tooltip contentStyle={{ background: '#0a1016', border: '1px solid #1a2840' }} />
                              <Area type="monotone" dataKey="p" stroke="#00ccff" fillOpacity={1} fill="url(#colorPv)" />
                              <Area type="monotone" dataKey="hi" stroke="none" fill="#00ccff" fillOpacity={0.1} />
                              <Area type="monotone" dataKey="lo" stroke="none" fill="#00ccff" fillOpacity={0.1} />
                            </AreaChart>
                         </ResponsiveContainer>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
