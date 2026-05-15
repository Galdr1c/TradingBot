import React, { useEffect, useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, TrendingDown, RefreshCw, Zap, GitBranch, Activity } from 'lucide-react';
import * as api from '../api';

const fmt  = (n, d = 2) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d }) : '—';
const fmtP = n => n != null ? `${n >= 0 ? '+' : ''}${fmt(n)}%` : '—';
const colorOf = n => n >= 0 ? 'var(--green)' : 'var(--red)';

/* ── Sub-components ──────────────────────────────────────────────────────── */

function StatRow({ label, value, color, bar, barColor }) {
  return (
    <div className="stat-row">
      <span className="stat-label">{label}</span>
      <span className="stat-val" style={{ color: color || 'var(--cyan)' }}>{value}</span>
      {bar != null && (
        <div className="bar-track" style={{ width:60 }}>
          <div className="bar-fill" style={{ width:`${Math.min(100, Math.max(0, bar))}%`, background: barColor || 'var(--cyan)' }} />
        </div>
      )}
    </div>
  );
}

function SignalBadge({ signal, confidence }) {
  const map = {
    'STRONG BUY': 'var(--green)', 'BUY': 'var(--green)',
    'STRONG SELL':'var(--red)',   'SELL':'var(--red)',
    'NEUTRAL':    'var(--orange)'
  };
  const c = map[signal] || 'var(--text2)';
  return (
    <div style={{ textAlign:'center' }}>
      <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:15, fontWeight:900, color:c, letterSpacing:1 }}>{signal || '—'}</div>
      {confidence != null && (
        <>
          <div className="conf-bar" style={{ marginTop:5 }}>
            <div className="conf-fill" style={{ width:`${confidence}%`, background:c }} />
          </div>
          <div style={{ fontSize:8, color:'var(--text2)', marginTop:2 }}>{confidence}% confidence</div>
        </>
      )}
    </div>
  );
}

function IndicatorPill({ label, value, color }) {
  return (
    <div style={{ background:'rgba(255,255,255,0.03)', border:'1px solid var(--panel-border)',
      borderRadius:6, padding:'5px 10px', textAlign:'center', minWidth:70 }}>
      <div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:.8, marginBottom:3 }}>{label}</div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:13, fontWeight:700, color: color || 'var(--cyan)' }}>{value ?? '—'}</div>
    </div>
  );
}

/* ── Main Dashboard ──────────────────────────────────────────────────────── */

export default function Dashboard({ tickers, logs, portfolio }) {
  const [chartData,   setChartData]   = useState([]);
  const [signal,      setSignal]      = useState(null);
  const [stats,       setStats]       = useState(null);
  const [otStatus,    setOtStatus]    = useState(null);
  const [selectedSym, setSelectedSym] = useState('BTC/USDT');
  const [loading,     setLoading]     = useState(false);

  const loadChart = useCallback(async () => {
    setLoading(true);
    try {
      // getHistory returns { data: [], signal: {}, symbol, interval }
      const res = await api.getHistory(selectedSym.replace('/','_'), '1h', 60);
      const rows = res?.data ?? [];
      setChartData(rows.map(d => ({
        t:   d.timestamp ? new Date(d.timestamp).getHours() + ':00' : '',
        p:   d.close,
        rsi: d.rsi,
        vol: d.volume,
      })));
      setSignal(res?.signal ?? null);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [selectedSym]);

  const loadStats = useCallback(async () => {
    try { setStats(await api.getSystemStats()); } catch {}
  }, []);

  const loadOtStatus = useCallback(async () => {
    try { setOtStatus(await api.getOpenTraderStatus()); } catch {}
  }, []);

  useEffect(() => {
    loadChart(); loadStats(); loadOtStatus();
    const t = setInterval(() => { loadChart(); loadStats(); }, 30000);
    return () => clearInterval(t);
  }, [loadChart, loadStats, loadOtStatus]);

  /* derived */
  const portVal  = portfolio?.total_value ?? 128450;
  const portPnl  = portfolio?.total_pnl   ?? 1240;
  const sigColor = signal?.signal?.includes('BUY')  ? 'var(--green)'
                 : signal?.signal?.includes('SELL') ? 'var(--red)'
                 : 'var(--orange)';
  const ind = signal?.indicators ?? {};

  return (
    <div className="col fade-in" style={{ gap:10 }}>

      {/* ── KPI row ──────────────────────────────────────────────────────── */}
      <div className="g4">
        {[
          { label:'PORTFOLIO',   val:`$${fmt(portVal)}`,                          color:'var(--cyan)',   sub:'Total Net Worth' },
          { label:'DAY P&L',     val:`${portPnl>=0?'+':''}$${fmt(portPnl)}`,      color:colorOf(portPnl), sub:'Realized + Unrealized' },
          { label:'MARKET BIAS', val:signal?.signal ?? 'LOADING',                 color:sigColor,         sub:`Conf: ${signal?.confidence ?? '—'}% · Score: ${signal?.score ?? '—'}` },
          { label:'ACTIVE BOTS', val:'4 / 6',                                     color:'var(--orange)',  sub:'Execution Active' },
        ].map(m => (
          <div key={m.label} className="mc">
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color:m.color }}>{m.val}</div>
            <div className="ms">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Indicator pills ───────────────────────────────────────────────── */}
      {signal && (
        <div className="indicator-grid">
          <IndicatorPill label="RSI"        value={ind.rsi?.toFixed(1)}     color={ind.rsi < 30 ? 'var(--green)' : ind.rsi > 70 ? 'var(--red)' : 'var(--cyan)'} />
          <IndicatorPill label="MACD"       value={ind.macd?.toFixed(3)}    color={ind.macd > 0 ? 'var(--green)' : 'var(--red)'} />
          <IndicatorPill label="MACD HIST"  value={ind.macd_hist?.toFixed(4)} color={ind.macd_hist > 0 ? 'var(--green)' : 'var(--red)'} />
          <IndicatorPill label="ADX"        value={ind.adx?.toFixed(1)}     color={ind.adx > 25 ? 'var(--orange)' : 'var(--text2)'} />
          <IndicatorPill label="WILLIAMS %R" value={ind.williams_r?.toFixed(0)} color={ind.williams_r < -80 ? 'var(--green)' : ind.williams_r > -20 ? 'var(--red)' : 'var(--text2)'} />
          <IndicatorPill label="BB POS"     value={`${ind.bb_pct?.toFixed(0)}%`} color={ind.bb_pct < 20 ? 'var(--green)' : ind.bb_pct > 80 ? 'var(--red)' : 'var(--text2)'} />
          <IndicatorPill label="CANDLE"     value={ind.candle_signal ? `${ind.candle_signal}` : '—'} color={ind.candle_signal === 'BULLISH' ? 'var(--green)' : ind.candle_signal === 'BEARISH' ? 'var(--red)' : 'var(--text2)'} />
          <IndicatorPill label="PATTERN"    value={ind.candle_pattern?.slice(0, 18)} color="var(--orange)" />
          <IndicatorPill label="EMA20"      value={ind.ema20 > 1000 ? `${(ind.ema20/1000).toFixed(2)}k` : ind.ema20?.toFixed(2)} color="var(--cyan)" />
          <IndicatorPill label="EMA50"      value={ind.ema50 > 1000 ? `${(ind.ema50/1000).toFixed(2)}k` : ind.ema50?.toFixed(2)} color="var(--purple)" />
        </div>
      )}

      {/* ── Chart row ─────────────────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 270px', gap:10, height:280 }}>
        {/* Price chart */}
        <div className="panel glow-cyan">
          <div className="ph">
            <span className="ac">■</span> PRICE CHART
            <div className="ph-actions">
              <select value={selectedSym} onChange={e => setSelectedSym(e.target.value)}
                style={{ width:120 }}>
                {['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AAPL','NVDA'].map(s =>
                  <option key={s} value={s}>{s}</option>)}
              </select>
              <button className="btn sm" onClick={loadChart} disabled={loading}>
                <RefreshCw size={10} className={loading?'spinner':''} />
              </button>
            </div>
          </div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top:4, right:4, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="gpd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--cyan)" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis domain={['auto','auto']} hide />
                <Tooltip contentStyle={{ background:'#040810', border:'1px solid #0f2040', fontSize:10, borderRadius:4 }}
                  formatter={v=>[`$${fmt(v)}`,'Price']} />
                <Area type="monotone" dataKey="p" stroke="var(--cyan)" strokeWidth={1.5} fill="url(#gpd)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* System + Signal panel */}
        <div className="panel">
          <div className="ph"><span className="ag">■</span> SYSTEM STATUS</div>
          <div className="sc" style={{ flex:1, padding:12 }}>
            <StatRow label="CPU"    value={`${stats?.cpu ?? 0}%`}               bar={stats?.cpu ?? 0}           barColor="var(--cyan)" />
            <StatRow label="MEMORY" value={`${stats?.memory_used_gb ?? 0} GB`}  bar={stats?.memory_pct ?? 0}    barColor="var(--purple)" />
            <div style={{ height:8 }} />
            <StatRow label="KRONOS"      value={stats?.kronos_status ?? 'READY'}      color="var(--orange)" />
            <StatRow label="AGENT-REACH" value={stats?.agent_reach_status ?? 'CONNECTED'} color="var(--green)" />
            <StatRow label="SWARM"       value={stats?.swarm_status ?? 'ACTIVE'}      color="var(--green)" />
            <StatRow label="OPENTRADER"  value={stats?.opentrader_status ?? '—'}
              color={stats?.opentrader_status === 'LIVE' ? 'var(--green)' : 'var(--orange)'} />
            <div style={{ height:8 }} />
            {signal && <SignalBadge signal={signal.signal} confidence={signal.confidence} />}
            {signal?.reasons?.length > 0 && (
              <div style={{ marginTop:8 }}>
                {signal.reasons.slice(0,3).map((r,i) => (
                  <div key={i} style={{ fontSize:8.5, color:'var(--text2)', padding:'2px 0', display:'flex', gap:5 }}>
                    <span style={{ color:sigColor }}>›</span> {r}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Market table + Logs ───────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 360px', gap:10, flex:1 }}>
        <div className="panel">
          <div className="ph"><span className="ac">■</span> MARKET OVERVIEW</div>
          <div className="sc" style={{ flex:1 }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>ASSET</th><th>PRICE</th><th>24H CHG</th>
                  <th>HIGH</th><th>LOW</th><th>TYPE</th>
                </tr>
              </thead>
              <tbody>
                {tickers.map(t => (
                  <tr key={t.symbol}>
                    <td style={{ fontWeight:700, color:'var(--text-bright)' }}>{t.symbol}</td>
                    <td style={{ color:'var(--text-bright)', fontFamily:'var(--font-display)', fontSize:11 }}>
                      ${fmt(t.price)}
                    </td>
                    <td>
                      <span style={{ color:colorOf(t.change), fontWeight:700, display:'flex', alignItems:'center', gap:3, fontSize:10 }}>
                        {t.change >= 0 ? <TrendingUp size={9}/> : <TrendingDown size={9}/>}
                        {fmtP(t.change)}
                      </span>
                    </td>
                    <td style={{ color:'var(--text2)', fontSize:10 }}>${fmt(t.high24h)}</td>
                    <td style={{ color:'var(--text2)', fontSize:10 }}>${fmt(t.low24h)}</td>
                    <td>
                      <span className="tag" style={{ background:'rgba(0,212,255,0.06)', color:'var(--text2)', border:'1px solid rgba(0,212,255,0.15)' }}>
                        {t.category?.toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Real-time logs */}
        <div className="panel">
          <div className="ph"><span className="ac">■</span> REAL-TIME LOGS</div>
          <div className="sc" style={{ flex:1, maxHeight:280 }}>
            {logs.slice(-40).map((l, i) => (
              <div key={i} className="log-l">
                <span className="ts">{l.t}</span>
                <span className={`log-${l.tp}`}>{l.m}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── OpenTrader quick status ───────────────────────────────────────── */}
      {otStatus && (
        <div className="panel">
          <div className="ph">
            <GitBranch size={12} color="var(--green)" />
            <span>OPENTRADER INTEGRATION</span>
            <span style={{ marginLeft:'auto', fontSize:9, color: otStatus.available ? 'var(--green)' : 'var(--orange)' }}>
              {otStatus.available ? `● LIVE  port ${otStatus.port}` : '○ SIMULATION MODE'}
            </span>
          </div>
          <div style={{ padding:'10px 16px', display:'flex', gap:16, alignItems:'center', flexWrap:'wrap' }}>
            {otStatus.strategies.map(s => (
              <div key={s} style={{ display:'flex', gap:6, alignItems:'center', fontSize:10 }}>
                <Activity size={11} color="var(--cyan)" />
                <span style={{ color:'var(--text-bright)', fontWeight:600, textTransform:'uppercase' }}>{s}</span>
                <span className="tag" style={{ background:'rgba(0,212,255,0.08)', color:'var(--cyan)', border:'1px solid rgba(0,212,255,0.2)', fontSize:8 }}>
                  {otStatus.available ? 'LIVE' : 'SIM'}
                </span>
              </div>
            ))}
            {!otStatus.available && (
              <span style={{ fontSize:9, color:'var(--text2)', marginLeft:'auto' }}>
                Install: <code style={{ color:'var(--cyan)' }}>npm install -g opentrader</code>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
