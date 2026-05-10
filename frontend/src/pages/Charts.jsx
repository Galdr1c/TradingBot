import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Bar } from 'recharts';
import { RefreshCw, Zap } from 'lucide-react';
import * as api from '../api';

const fmt = (n,d=2) => n!=null ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const colorOf = n => n>=0?'var(--green)':'var(--red)';

const SYMBOLS = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','XRP/USDT','AAPL','NVDA','TSLA','MSFT'];
const TIMEFRAMES = ['1m','5m','15m','1h','4h','1d'];

function IndicatorBadge({ label, value, color }) {
  return (
    <div className="ind-badge">
      <div className="ib-label">{label}</div>
      <div className="ib-val" style={{ color: color || 'var(--cyan)' }}>{value ?? '—'}</div>
    </div>
  );
}

export default function Charts() {
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [tf, setTf] = useState('1h');
  const [data, setData] = useState([]);
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState('price');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sym = symbol.replace('/','_');
      const [hist, sig] = await Promise.all([
        api.getHistory(sym, tf, 200),
        api.getSignal(sym, tf)
      ]);
      setData(hist.map(d => ({
        t: d.timestamp ? new Date(d.timestamp).toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'}) : '',
        p: d.close, o: d.open, h: d.high, l: d.low, v: d.volume,
        rsi: d.rsi, macd: d.macd, macd_s: d.macd_signal, macd_h: d.macd_hist,
        bb_u: d.bb_upper, bb_m: d.bb_mid, bb_l: d.bb_lower,
        ema20: d.ema_20, ema50: d.ema_50, stoch: d.stoch_k,
      })));
      setSignal(sig);
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [symbol, tf]);

  useEffect(() => { load(); }, [load]);

  const last = data[data.length - 1] || {};
  const sigColor = signal?.signal?.includes('BUY') ? 'var(--green)' : signal?.signal?.includes('SELL') ? 'var(--red)' : 'var(--orange)';
  const priceColor = data.length > 1 ? colorOf(last.p - data[0].p) : 'var(--cyan)';

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {/* Controls */}
      <div className="panel">
        <div style={{ padding:'8px 14px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={{ width:130 }}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ display:'flex', gap:4 }}>
            {TIMEFRAMES.map(t => (
              <button key={t} className={`btn sm ${tf===t?'':''}` } onClick={() => setTf(t)}
                style={{ background: tf===t?'rgba(0,212,255,0.2)':'', borderColor: tf===t?'var(--cyan)':'' }}>
                {t}
              </button>
            ))}
          </div>
          <button className="btn sm" onClick={load} disabled={loading}>
            <RefreshCw size={10} className={loading?'spinner':''} /> {loading?'LOADING...':'REFRESH'}
          </button>
          <div style={{ marginLeft:'auto', display:'flex', gap:16, alignItems:'center' }}>
            <span style={{ fontFamily:'Orbitron,sans-serif', fontSize:16, fontWeight:700, color:priceColor }}>
              ${fmt(last.p)}
            </span>
            {signal && <span style={{ fontFamily:'Orbitron,sans-serif', fontSize:12, fontWeight:700, color:sigColor }}>{signal.signal}</span>}
          </div>
        </div>
      </div>

      {/* Indicator Badges */}
      <div style={{ display:'flex', gap:8, overflowX:'auto' }}>
        {[
          { label:'RSI', value: last.rsi?.toFixed(1), color: last.rsi > 70 ? 'var(--red)' : last.rsi < 30 ? 'var(--green)' : 'var(--cyan)' },
          { label:'EMA 20', value: last.ema20?.toFixed(2), color:'var(--cyan)' },
          { label:'EMA 50', value: last.ema50?.toFixed(2), color:'var(--purple)' },
          { label:'MACD', value: last.macd?.toFixed(3), color: last.macd > 0 ? 'var(--green)' : 'var(--red)' },
          { label:'STOCH K', value: last.stoch?.toFixed(1), color:'var(--orange)' },
          { label:'BB UPPER', value: last.bb_u?.toFixed(2), color:'var(--text2)' },
          { label:'BB LOWER', value: last.bb_l?.toFixed(2), color:'var(--text2)' },
        ].map(b => <IndicatorBadge key={b.label} {...b} />)}
      </div>

      {/* Chart Tabs */}
      <div className="panel" style={{ flex:1, minHeight:300 }}>
        <div className="tabs">
          {['price','rsi','macd','volume'].map(t => (
            <div key={t} className={`tab ${tab===t?'act':''}`} onClick={() => setTab(t)}>{t.toUpperCase()}</div>
          ))}
          {signal && (
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center', paddingRight:14 }}>
              {(signal.reasons||[]).slice(0,2).map((r,i) => (
                <span key={i} style={{ fontSize:8, color:'var(--text2)', background:'rgba(255,255,255,0.03)', padding:'2px 7px', borderRadius:2, border:'1px solid var(--border)' }}>{r}</span>
              ))}
            </div>
          )}
        </div>
        <div className="chart-area" style={{ padding:'8px 4px' }}>
          <ResponsiveContainer width="100%" height="100%">
            {tab === 'price' ? (
              <AreaChart data={data} margin={{top:4,right:4,left:0,bottom:0}}>
                <defs>
                  <linearGradient id="gp2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--cyan)" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="var(--cyan)" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="gbb" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--purple)" stopOpacity={0.08}/>
                    <stop offset="95%" stopColor="var(--purple)" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={['auto','auto']} tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} width={60}
                  tickFormatter={v=>v>1000?`${(v/1000).toFixed(1)}k`:v.toFixed(2)} />
                <Tooltip contentStyle={{background:'#040810',border:'1px solid #0f2040',fontSize:10,borderRadius:4}} formatter={(v)=>[`$${fmt(v)}`,'Price']} />
                <Area type="monotone" dataKey="bb_u" stroke="rgba(124,77,255,0.3)" strokeWidth={1} fill="none" dot={false} />
                <Area type="monotone" dataKey="bb_l" stroke="rgba(124,77,255,0.3)" strokeWidth={1} fill="url(#gbb)" dot={false} />
                <Area type="monotone" dataKey="ema20" stroke="rgba(0,212,255,0.6)" strokeWidth={1} fill="none" dot={false} />
                <Area type="monotone" dataKey="ema50" stroke="rgba(255,170,0,0.5)" strokeWidth={1} fill="none" dot={false} />
                <Area type="monotone" dataKey="p" stroke="var(--cyan)" strokeWidth={1.5} fill="url(#gp2)" dot={false} />
              </AreaChart>
            ) : tab === 'rsi' ? (
              <AreaChart data={data} margin={{top:4,right:4,left:0,bottom:0}}>
                <defs><linearGradient id="grsi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--purple)" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="var(--purple)" stopOpacity={0}/>
                </linearGradient></defs>
                <XAxis dataKey="t" tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis domain={[0,100]} tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} width={30} />
                <Tooltip contentStyle={{background:'#040810',border:'1px solid #0f2040',fontSize:10,borderRadius:4}} />
                <ReferenceLine y={70} stroke="rgba(255,45,85,0.4)" strokeDasharray="4 4" />
                <ReferenceLine y={30} stroke="rgba(0,232,122,0.4)" strokeDasharray="4 4" />
                <Area type="monotone" dataKey="rsi" stroke="var(--purple)" strokeWidth={1.5} fill="url(#grsi)" dot={false} />
              </AreaChart>
            ) : tab === 'macd' ? (
              <ComposedChart data={data} margin={{top:4,right:4,left:0,bottom:0}}>
                <XAxis dataKey="t" tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} width={40} />
                <Tooltip contentStyle={{background:'#040810',border:'1px solid #0f2040',fontSize:10,borderRadius:4}} />
                <ReferenceLine y={0} stroke="var(--border2)" />
                <Bar dataKey="macd_h" fill="var(--cyan)" opacity={0.5} />
                <Area type="monotone" dataKey="macd" stroke="var(--cyan)" strokeWidth={1.5} fill="none" dot={false} />
                <Area type="monotone" dataKey="macd_s" stroke="var(--orange)" strokeWidth={1.2} fill="none" dot={false} />
              </ComposedChart>
            ) : (
              <ComposedChart data={data} margin={{top:4,right:4,left:0,bottom:0}}>
                <XAxis dataKey="t" tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} width={50} tickFormatter={v=>`${(v/1e6).toFixed(1)}M`} />
                <Tooltip contentStyle={{background:'#040810',border:'1px solid #0f2040',fontSize:10,borderRadius:4}} />
                <Bar dataKey="v" fill="var(--cyan)" opacity={0.4} />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>

      {/* Signal detail */}
      {signal && (
        <div className="panel">
          <div className="ph"><span className="ac">■</span> SIGNAL ANALYSIS — {symbol}</div>
          <div style={{ padding:14, display:'flex', gap:20, alignItems:'flex-start' }}>
            <div style={{ textAlign:'center', minWidth:120 }}>
              <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:22, fontWeight:900, color:sigColor }}>{signal.signal}</div>
              <div style={{ fontSize:9, color:'var(--text2)', marginTop:4 }}>CONFIDENCE</div>
              <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:16, color:sigColor }}>{signal.confidence}%</div>
              <div className="conf-bar" style={{ marginTop:6 }}>
                <div className="conf-fill" style={{ width:`${signal.confidence}%`, background:sigColor }} />
              </div>
            </div>
            <div className="col" style={{ gap:6, flex:1 }}>
              <div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.5, marginBottom:2 }}>SIGNAL REASONS</div>
              {(signal.reasons||[]).map((r,i) => (
                <div key={i} style={{ display:'flex', gap:8, alignItems:'center', fontSize:10, color:'var(--text)' }}>
                  <span style={{ color:'var(--cyan)' }}>›</span> {r}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
