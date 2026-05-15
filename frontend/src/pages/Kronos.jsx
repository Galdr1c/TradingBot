import React, { useState, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { BrainCircuit, Zap, RefreshCw } from 'lucide-react';
import * as api from '../api';

const fmt = (n, d = 2) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits:d, maximumFractionDigits:d }) : '—';

const SYMBOLS  = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AAPL','NVDA','TSLA'];
const HORIZONS = [12, 24, 48, 72];

export default function Kronos() {
  const [symbol,  setSymbol]  = useState('BTC/USDT');
  const [horizon, setHorizon] = useState(24);
  const [tf,      setTf]      = useState('1h');
  const [result,  setResult]  = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [temperature] = useState(0.7);
  const [topP]        = useState(0.9);

  const runForecast = useCallback(async () => {
    setLoading(true);
    try {
      const sym = symbol.replace('/', '_');

      // BUG-FIX: getHistory returns { data:[], signal:{} } — extract .data
      const [pred, histRes] = await Promise.all([
        api.getPrediction(sym, tf, horizon),
        api.getHistory(sym, tf, 60),
      ]);
      setResult(pred);

      const histRows = histRes?.data ?? [];

      const histPoints = histRows.slice(-40).map(d => ({
        t:       d.timestamp ? new Date(d.timestamp).toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' }) : '',
        actual:  d.close,
        forecast: null,
        hi:      null,
        lo:      null,
        isHist:  true,
      }));

      const fc = pred?.forecast ?? [];
      const fcPoints = fc.map(d => ({
        t:       d.timestamp ? new Date(d.timestamp).toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' }) : `+${d.t+1}h`,
        actual:  null,
        forecast: d.p,
        hi:      d.hi,
        lo:      d.lo,
        isHist:  false,
      }));

      // Bridge: connect last actual to first forecast point
      if (histPoints.length && fcPoints.length) {
        fcPoints[0].actual = histPoints[histPoints.length - 1].actual;
      }

      setHistory([...histPoints, ...fcPoints]);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [symbol, tf, horizon]);

  const fc         = result?.forecast ?? [];
  const lastActual = history.filter(h => h.isHist).slice(-1)[0]?.actual ?? 0;
  const lastFc     = fc.slice(-1)[0]?.p ?? 0;
  const fcChange   = lastActual ? ((lastFc - lastActual) / lastActual) * 100 : 0;
  const fcColor    = fcChange >= 0 ? 'var(--green)' : 'var(--red)';

  return (
    <div className="col fade-in" style={{ gap:10 }}>

      {/* Header */}
      <div className="panel">
        <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:14 }}>
          <BrainCircuit size={20} color="var(--purple)" />
          <div>
            <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:11, fontWeight:700, color:'var(--text-bright)', letterSpacing:2 }}>
              KRONOS FOUNDATION MODEL
            </div>
            <div style={{ fontSize:9, color:'var(--text2)', marginTop:2 }}>
              Zero-shot financial time series forecasting · NeoQuasar/Kronos-small · AAAI 2026
            </div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ width:120 }}>
              {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={tf} onChange={e => setTf(e.target.value)}>
              {['1h','4h','1d'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}>
              {HORIZONS.map(h => <option key={h} value={h}>{h} bars</option>)}
            </select>
            <button className="btn" onClick={runForecast} disabled={loading}
              style={{ background:'rgba(124,77,255,0.15)', borderColor:'rgba(124,77,255,0.4)', color:'#a87fff' }}>
              {loading ? <RefreshCw size={11} className="spinner" /> : <Zap size={11} />}
              {loading ? 'FORECASTING...' : '⚡ RUN FORECAST'}
            </button>
          </div>
        </div>
      </div>

      {/* Params + metrics */}
      <div style={{ display:'grid', gridTemplateColumns:'180px 1fr 1fr 1fr', gap:10 }}>
        <div className="panel">
          <div className="ph"><span className="ap">■</span> MODEL PARAMS</div>
          <div className="fc-params" style={{ padding:12 }}>
            {[
              { label:'TEMPERATURE', val:temperature.toFixed(1) },
              { label:'TOP_P',       val:topP.toFixed(1) },
              { label:'HORIZON',     val:`${horizon} BARS` },
              { label:'TIMEFRAME',   val:tf.toUpperCase() },
              { label:'DEVICE',      val:'CPU' },
              { label:'MAX CTX',     val:'512' },
            ].map(p => (
              <div key={p.label} style={{ display:'flex', justifyContent:'space-between', fontSize:9.5, padding:'4px 0', borderBottom:'1px solid rgba(255,255,255,0.05)' }}>
                <span style={{ color:'var(--text2)' }}>{p.label}</span>
                <span style={{ color:'var(--cyan)', fontFamily:'var(--font-mono)' }}>{p.val}</span>
              </div>
            ))}
          </div>
        </div>

        {[
          { label:'FORECAST END',      val: fc.length ? `$${fmt(fc[fc.length-1]?.p)}` : '—',                          color:'var(--cyan)',   sub: result ? `${horizon}-bar horizon` : 'Run forecast first' },
          { label:'EXPECTED MOVE',     val: result ? `${fcChange >= 0 ? '+' : ''}${fmt(fcChange)}%` : '—',            color:fcColor,         sub:'From last close' },
          { label:'CONFIDENCE BAND',   val: fc.length ? `±$${fmt((fc[fc.length-1]?.hi ?? 0) - (fc[fc.length-1]?.p ?? 0))}` : '—', color:'var(--orange)', sub:'95% prediction interval' },
        ].map(m => (
          <div key={m.label} className="mc" style={{ display:'flex', flexDirection:'column', justifyContent:'center' }}>
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color:m.color }}>{m.val}</div>
            <div className="ms">{m.sub}</div>
          </div>
        ))}
      </div>

      {/* Forecast chart */}
      <div className="panel glow-cyan" style={{ flex:1, minHeight:320 }}>
        <div className="ph">
          <span className="ac">■</span> {symbol} · KRONOS FORECAST ({horizon} BARS)
          {result && (
            <span style={{ marginLeft:8, fontSize:8, color:'var(--text2)' }}>
              {result.model} · {new Date(result.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>

        {!result ? (
          <div className="loading-cell" style={{ flex:1, flexDirection:'column', gap:12 }}>
            <BrainCircuit size={32} color="rgba(124,77,255,0.3)" />
            <div style={{ color:'var(--text2)', fontSize:11 }}>Click "RUN FORECAST" to generate predictions</div>
            <div style={{ fontSize:9, color:'var(--text2)', opacity:.7 }}>
              Kronos analyses K-line patterns → forecasts next {horizon} bars with confidence bands
            </div>
          </div>
        ) : (
          <div style={{ flex:1, padding:'8px 4px' }}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top:4, right:4, left:0, bottom:0 }}>
                <defs>
                  <linearGradient id="gact" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--cyan)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gfc" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--purple)" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="var(--purple)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gband" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="var(--orange)" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="var(--orange)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{ fontSize:7.5, fill:'var(--text2)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={['auto','auto']} tick={{ fontSize:8, fill:'var(--text2)' }} tickLine={false} axisLine={false} width={65}
                  tickFormatter={v => v > 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(2)}`} />
                <Tooltip contentStyle={{ background:'#040810', border:'1px solid #0f2040', fontSize:9.5, borderRadius:4 }}
                  formatter={(v, n) => v != null ? [`$${fmt(v)}`, n==='actual'?'Price':n==='forecast'?'Kronos':n==='hi'?'Upper':' Lower'] : [null]} />
                <ReferenceLine
                  x={history.filter(h => h.isHist).slice(-1)[0]?.t}
                  stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4"
                  label={{ value:'NOW', position:'top', fontSize:8, fill:'var(--text2)' }} />
                <Area type="monotone" dataKey="hi"       stroke="rgba(255,170,0,0.2)" strokeWidth={1} fill="url(#gband)" dot={false} />
                <Area type="monotone" dataKey="lo"       stroke="rgba(255,170,0,0.2)" strokeWidth={1} fill="url(#gband)" dot={false} />
                <Area type="monotone" dataKey="actual"   stroke="var(--cyan)"   strokeWidth={1.5} fill="url(#gact)" dot={false} connectNulls />
                <Area type="monotone" dataKey="forecast" stroke="var(--purple)" strokeWidth={2}   fill="url(#gfc)"  dot={false} strokeDasharray="6 3" connectNulls />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Forecast table */}
      {result && fc.length > 0 && (
        <div className="panel">
          <div className="ph"><span className="ap">■</span> FORECAST TABLE · FIRST 12 BARS</div>
          <div className="sc" style={{ maxHeight:160 }}>
            <table className="tbl">
              <thead>
                <tr><th>BAR</th><th>FORECAST</th><th>UPPER BAND</th><th>LOWER BAND</th><th>RANGE (±)</th><th>TIMESTAMP</th></tr>
              </thead>
              <tbody>
                {fc.slice(0, 12).map((f, i) => {
                  const chg = lastActual ? ((f.p - lastActual) / lastActual * 100) : 0;
                  return (
                    <tr key={i}>
                      <td style={{ color:'var(--text2)' }}>+{i+1}</td>
                      <td style={{ color:'var(--purple)', fontFamily:'Orbitron,sans-serif', fontSize:10 }}>
                        ${fmt(f.p)}
                        <span style={{ fontSize:8, color: chg>=0?'var(--green)':'var(--red)', marginLeft:5 }}>
                          {chg>=0?'+':''}{chg.toFixed(2)}%
                        </span>
                      </td>
                      <td style={{ color:'var(--text2)', fontSize:10 }}>${fmt(f.hi)}</td>
                      <td style={{ color:'var(--text2)', fontSize:10 }}>${fmt(f.lo)}</td>
                      <td style={{ color:'var(--orange)', fontSize:10 }}>±${fmt(f.hi - f.p)}</td>
                      <td style={{ color:'var(--text2)', fontSize:9, fontFamily:'var(--font-mono)' }}>
                        {new Date(f.timestamp).toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
