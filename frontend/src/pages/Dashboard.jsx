import React, { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { TrendingUp, TrendingDown, Activity, Cpu, Database, RefreshCw } from 'lucide-react';
import * as api from '../api';

const fmt = (n, d = 2) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const fmtP = (n) => n != null ? `${n >= 0 ? '+' : ''}${fmt(n)}%` : '—';
const colorOf = (n) => n >= 0 ? 'var(--green)' : 'var(--red)';

function StatRow({ label, value, color, bar, barColor }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-val" style={{ color: color || 'var(--cyan)' }}>{value}</span>
      {bar != null && (
        <div className="bar-track" style={{ width: 60 }}>
          <div className="bar-fill" style={{ width: `${Math.min(100, bar)}%`, background: barColor || 'var(--cyan)' }} />
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ tickers, logs, portfolio }) {
  const [chartData, setChartData] = useState([]);
  const [signal, setSignal] = useState(null);
  const [stats, setStats] = useState(null);
  const [prediction, setPrediction] = useState([]);
  const [newsSentiment, setNewsSentiment] = useState({ sentiment: 'neutral', score: 0 });
  const [selectedSym, setSelectedSym] = useState('BTC/USDT');

  const loadChart = useCallback(async () => {
    try {
      const { data, signal } = await api.getHistory(selectedSym, '1h', 48);
      setChartData(data.map(d => ({
        t: new Date(d.timestamp).getHours() + ':00',
        p: d.close,
        rsi: d.rsi
      })));
      setSignal(signal);
    } catch (e) { }
  }, [selectedSym]);

  const loadPrediction = useCallback(async () => {
    try {
      const { predictions } = await api.getPrediction(selectedSym, 5);
      setPrediction(predictions);
    } catch (e) { }
  }, [selectedSym]);

  const loadNews = useCallback(async () => {
    try {
      // Need an endpoint for news sentiment, adding placeholder for now
      // const n = await api.getNewsSentiment(selectedSym);
      // setNewsSentiment(n);
    } catch (e) { }
  }, [selectedSym]);

  const loadSignal = useCallback(async () => {
    try { const s = await api.getSignal(selectedSym); setSignal(s); } catch (e) { }
  }, [selectedSym]);

  // Update effect to refresh data
  useEffect(() => { loadChart(); loadPrediction(); loadNews(); loadSignal(); }, [loadChart, loadPrediction, loadNews, loadSignal]);

  // Inside return statement, update chart area to include prediction line
  // (Assuming integration of Recharts Line component)
  // ...
  /* In the Chart render: */
  /* <Area ... /> */
  /* <Line type="monotone" dataKey="prediction" stroke="var(--purple)" strokeDasharray="5 5" /> */
  useEffect(() => { const id = setInterval(() => { loadChart(); loadSignal(); }, 30000); return () => clearInterval(id); }, [loadChart, loadSignal]);

  const portVal = portfolio?.total_value ?? 128450;
  const portPnl = portfolio?.total_pnl ?? 1240;
  const activeBots = 4;

  const sigColor = signal?.signal?.includes('BUY') ? 'var(--green)' : signal?.signal?.includes('SELL') ? 'var(--red)' : 'var(--orange)';

  return (
    <div className="col fade-in" style={{ gap: 10 }}>
      {/* Metric row */}
      <div className="g4">
        {[
          { label: 'PORTFOLIO', val: `$${fmt(portVal)}`, color: 'var(--cyan)', sub: 'Total Net Worth' },
          { label: 'DAY P&L', val: `${portPnl >= 0 ? '+' : ''}$${fmt(portPnl)}`, color: colorOf(portPnl), sub: 'Realized + Unrealized' },
          { label: 'ACTIVE BOTS', val: `${activeBots} / 6`, color: 'var(--orange)', sub: 'Execution Active' },
          { label: 'MARKET BIAS', val: signal?.signal ?? 'LOADING', color: sigColor, sub: `Confidence: ${signal?.confidence ?? '—'}%` },
        ].map(m => (
          <div key={m.label} className="mc">
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color: m.color }}>{m.val}</div>
            <div className="ms">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Chart + System */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 10, height: 280 }}>
        <div className="panel glow-cyan">
          <div className="ph">
            <span className="ac">■</span> PRICE CHART
            <div className="ph-actions">
              <select value={selectedSym} onChange={e => setSelectedSym(e.target.value)}>
                <option value="BTC_USDT">BTC/USDT</option>
                <option value="ETH_USDT">ETH/USDT</option>
                <option value="SOL_USDT">SOL/USDT</option>
                <option value="AAPL">AAPL</option>
                <option value="NVDA">NVDA</option>
              </select>
              <button className="btn sm" onClick={loadChart}><RefreshCw size={10} /></button>
            </div>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--cyan)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis domain={['auto', 'auto']} hide />
                <Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 10, borderRadius: 4 }} />
                <Area type="monotone" dataKey="p" stroke="var(--cyan)" strokeWidth={1.5} fill="url(#gp)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="ph"><span className="ag">■</span> SYSTEM STATUS</div>
          <div className="sc" style={{ flex: 1, padding: 12 }}>
            <StatRow label="CPU" value={`${stats?.cpu?.toFixed(1) ?? 0}%`} bar={stats?.cpu ?? 0} barColor="var(--cyan)" />
            <StatRow label="MEMORY" value={`${stats?.memory_used_gb ?? 0} GB`} color="var(--text3)" bar={stats?.memory_pct ?? 0} barColor="var(--purple)" />
            <div style={{ height: 8 }} />
            <StatRow label="KRONOS MODEL" value={stats?.kronos_status ?? 'READY'} color="var(--orange)" />
            <StatRow label="AGENT REACH" value={stats?.agent_reach_status ?? 'CONNECTED'} color="var(--green)" />
            <StatRow label="SWARM" value={stats?.swarm_status ?? 'ACTIVE'} color="var(--green)" />
            <div style={{ height: 8 }} />
            {signal && (
              <>
                <div style={{ fontSize: 7.5, color: 'var(--text2)', letterSpacing: 1.5, marginBottom: 6 }}>TECHNICAL SIGNAL</div>
                <div style={{ fontSize: 12, fontFamily: 'Orbitron,sans-serif', color: sigColor, fontWeight: 700 }}>{signal.signal}</div>
                <div className="conf-bar" style={{ marginTop: 4 }}>
                  <div className="conf-fill" style={{ width: `${signal.confidence ?? 50}%`, background: sigColor }} />
                </div>
                <div style={{ fontSize: 8.5, color: 'var(--text2)', marginTop: 3 }}>Confidence: {signal.confidence}%</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Market Table + Logs */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 10, flex: 1 }}>
        <div className="panel">
          <div className="ph"><span className="ac">■</span> MARKET OVERVIEW</div>
          <div className="sc" style={{ flex: 1 }}>
            <table className="tbl">
              <thead><tr><th>ASSET</th><th>PRICE</th><th>24H CHG</th><th>HIGH</th><th>LOW</th><th>TYPE</th></tr></thead>
              <tbody>
                {tickers.map(t => (
                  <tr key={t.symbol}>
                    <td style={{ fontWeight: 600, color: 'var(--text3)' }}>{t.symbol}</td>
                    <td style={{ color: 'var(--text3)' }}>${fmt(t.price)}</td>
                    <td style={{ color: colorOf(t.change), fontWeight: 600 }}>{fmtP(t.change)}</td>
                    <td style={{ color: 'var(--text2)' }}>${fmt(t.high24h)}</td>
                    <td style={{ color: 'var(--text2)' }}>${fmt(t.low24h)}</td>
                    <td><span className="tag" style={{ background: 'rgba(0,212,255,0.06)', color: 'var(--text2)', border: '1px solid var(--border2)' }}>{t.category?.toUpperCase()}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <div className="ph"><span className="ac">■</span> REAL-TIME LOGS</div>
          <div className="sc" style={{ flex: 1 }}>
            {logs.slice(-30).map((l, i) => (
              <div key={i} className="log-l">
                <span className="ts">{l.t}</span>
                <span className={`log-${l.tp}`}>{l.m}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
