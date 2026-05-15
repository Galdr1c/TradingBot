import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, BarChart, Bar, LineChart, Line, ComposedChart } from 'recharts';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import * as api from '../api';
import { EmptyState, ErrorState, LoadingState, useToast } from '../components/AppShellUtils';

const fmt = (n, d = 2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const colorOf = n => Number(n) >= 0 ? 'var(--green)' : 'var(--red)';
const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT', 'AAPL', 'NVDA', 'TSLA', 'MSFT'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];
const TABS = ['price', 'rsi', 'macd', 'adx', 'volume'];

function IndicatorBadge({ label, value, color }) {
  return <div className="ind-badge"><div className="ib-label">{label}</div><div className="ib-val" style={{ color: color || 'var(--cyan)' }}>{value ?? '—'}</div></div>;
}

export default function Charts({ externalSymbol }) {
  const { notify } = useToast();
  const [symbol, setSymbol] = useState(externalSymbol || 'BTC/USDT');
  const [tf, setTf] = useState('1h');
  const [data, setData] = useState([]);
  const [signal, setSignal] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('price');

  useEffect(() => {
    if (externalSymbol && externalSymbol !== symbol) setSymbol(externalSymbol);
  }, [externalSymbol]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [histRes, sig] = await Promise.all([api.getHistory(symbol, tf, 240), api.getSignal(symbol, tf)]);
      const rows = Array.isArray(histRes?.data) ? histRes.data : [];
      const mapped = rows.map(d => ({
        t: d.timestamp ? new Date(d.timestamp).toLocaleString('tr-TR', { day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '',
        p: d.close, o: d.open, h: d.high, l: d.low, v: d.volume,
        rsi: d.rsi, macd: d.macd, macd_s: d.macd_signal, macd_h: d.macd_hist,
        bb_u: d.bb_upper, bb_m: d.bb_mid, bb_l: d.bb_lower,
        ema20: d.ema_20, ema50: d.ema_50, ema200: d.ema_200,
        adx: d.adx, williams: d.williams_r, stoch: d.stoch_k, vwap: d.vwap, obv: d.obv,
        candlePattern: d.candle_pattern, candleSignal: d.candle_signal, candleScore: d.candle_score,
        source: d.source,
      })).filter(d => Number.isFinite(Number(d.p)));
      setData(mapped);
      setSignal(sig || histRes?.signal || null);
      if (histRes?.error) notify(histRes.error, 'error');
    } catch (e) {
      setError(e); setData([]); setSignal(null); notify(`Grafik yüklenemedi: ${e.message}`, 'error');
    } finally { setLoading(false); }
  }, [symbol, tf, notify]);

  useEffect(() => { load(); }, [load]);

  const last = data[data.length - 1] || {};
  const sigColor = signal?.signal?.includes('BUY') ? 'var(--green)' : signal?.signal?.includes('SELL') ? 'var(--red)' : 'var(--orange)';
  const priceColor = data.length > 1 ? colorOf(Number(last.p) - Number(data[0].p)) : 'var(--cyan)';
  const isDemo = signal?.quality?.is_demo || last.source === 'demo';

  const badges = [
    { label: 'RSI', value: Number.isFinite(last.rsi) ? last.rsi.toFixed(1) : null, color: last.rsi < 30 ? 'var(--green)' : last.rsi > 70 ? 'var(--red)' : 'var(--cyan)' },
    { label: 'MACD', value: Number.isFinite(last.macd) ? last.macd.toFixed(3) : null, color: last.macd > 0 ? 'var(--green)' : 'var(--red)' },
    { label: 'MACD HIST', value: Number.isFinite(last.macd_h) ? last.macd_h.toFixed(4) : null, color: last.macd_h > 0 ? 'var(--green)' : 'var(--red)' },
    { label: 'ADX', value: Number.isFinite(last.adx) ? last.adx.toFixed(1) : null, color: last.adx > 25 ? 'var(--orange)' : 'var(--text2)' },
    { label: 'W%R', value: Number.isFinite(last.williams) ? last.williams.toFixed(0) : null, color: last.williams < -80 ? 'var(--green)' : last.williams > -20 ? 'var(--red)' : 'var(--text2)' },
    { label: 'EMA 20', value: Number.isFinite(last.ema20) ? last.ema20.toFixed(2) : null, color: 'var(--cyan)' },
    { label: 'EMA 50', value: Number.isFinite(last.ema50) ? last.ema50.toFixed(2) : null, color: 'var(--purple)' },
    { label: 'EMA 200', value: Number.isFinite(last.ema200) ? last.ema200.toFixed(2) : null, color: 'var(--orange)' },
    { label: 'VWAP', value: Number.isFinite(last.vwap) ? `$${fmt(last.vwap)}` : null, color: 'var(--orange)' },
    { label: 'CANDLE', value: last.candleSignal, color: last.candleSignal === 'BULLISH' ? 'var(--green)' : last.candleSignal === 'BEARISH' ? 'var(--red)' : 'var(--text2)' },
    { label: 'PATTERN', value: last.candlePattern?.slice(0, 18), color: 'var(--orange)' },
    { label: 'SOURCE', value: signal?.quality?.source || last.source || '—', color: isDemo ? 'var(--orange)' : 'var(--green)' },
  ];

  return (
    <div className="col fade-in" style={{ gap: 12 }}>
      <div className="panel">
        <div style={{ padding: '10px 14px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ width: 140 }} aria-label="Sembol seç">
            {[...new Set([symbol, ...SYMBOLS])].map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {TIMEFRAMES.map(t => <button key={t} type="button" className="btn sm" onClick={() => setTf(t)} style={{ background: tf === t ? 'rgba(0,212,255,0.2)' : '', borderColor: tf === t ? 'var(--cyan)' : '' }}>{t}</button>)}
          </div>
          <button type="button" className="btn sm" onClick={load} disabled={loading}><RefreshCw size={10} className={loading ? 'spinner' : ''} /> {loading ? 'YÜKLENİYOR...' : 'YENİLE'}</button>
          {isDemo && <div className="data-warning"><AlertTriangle size={14} /> Demo veri — sağlayıcı/cache yok</div>}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 16, alignItems: 'center' }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 17, fontWeight: 800, color: priceColor }}>${fmt(last.p)}</span>
            {signal && <span style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 800, color: sigColor }}>{signal.signal} {signal.confidence}%</span>}
          </div>
        </div>
      </div>

      <div className="indicator-grid">{badges.map(b => <IndicatorBadge key={b.label} {...b} />)}</div>

      {signal?.risk && <div className="risk-grid">
        <div className="risk-card"><span>Last</span><strong>${fmt(signal.risk.last_price)}</strong></div>
        <div className="risk-card"><span>Stop Loss</span><strong>${fmt(signal.risk.stop_loss)}</strong></div>
        <div className="risk-card"><span>Take Profit</span><strong>${fmt(signal.risk.take_profit)}</strong></div>
        <div className="risk-card"><span>ATR</span><strong>{fmt(signal.risk.atr_pct, 2)}%</strong></div>
      </div>}

      <div className="panel" style={{ flex: 1, minHeight: 360 }}>
        <div className="tabs">
          {TABS.map(t => <button type="button" key={t} className={`tab ${tab === t ? 'act' : ''}`} onClick={() => setTab(t)}>{t.toUpperCase()}</button>)}
          {signal?.reasons?.length > 0 && <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center', paddingRight: 14, flexWrap: 'wrap' }}>{signal.reasons.slice(0, 2).map((r, i) => <span key={i} style={{ fontSize: 9, color: 'var(--text2)', background: 'rgba(255,255,255,0.035)', padding: '4px 8px', borderRadius: 999, border: '1px solid var(--border)' }}>{r}</span>)}</div>}
        </div>
        <div className="chart-area">
          {loading ? <LoadingState text="Piyasa verisi alınıyor..." /> : error ? <ErrorState error={error} onRetry={load} /> : data.length < 2 ? <EmptyState title="Grafik verisi yok" text="Sembol veya zaman aralığı için yeterli mum bulunamadı." action={<button className="btn sm" type="button" onClick={load}>Tekrar dene</button>} /> : <ChartByTab tab={tab} data={data} last={last} />}
        </div>
      </div>
    </div>
  );
}

function ChartByTab({ tab, data, last }) {
  if (tab === 'price') return <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}><defs><linearGradient id="gp2" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--cyan)" stopOpacity={0.2} /><stop offset="95%" stopColor="var(--cyan)" stopOpacity={0} /></linearGradient></defs><XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis domain={['auto', 'auto']} tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} width={70} tickFormatter={v => v > 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${Number(v).toFixed(2)}`} /><Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 11, borderRadius: 10 }} formatter={v => [`$${fmt(v)}`, 'Price']} />{Number.isFinite(last.vwap) && <ReferenceLine y={last.vwap} stroke="rgba(255,224,0,0.45)" strokeDasharray="4 4" />}<Area type="monotone" dataKey="bb_u" stroke="rgba(124,77,255,0.35)" strokeWidth={1} fill="none" dot={false} /><Area type="monotone" dataKey="bb_l" stroke="rgba(124,77,255,0.35)" strokeWidth={1} fill="none" dot={false} /><Area type="monotone" dataKey="ema20" stroke="rgba(0,212,255,0.65)" strokeWidth={1} fill="none" dot={false} /><Area type="monotone" dataKey="ema50" stroke="rgba(255,170,0,0.55)" strokeWidth={1} fill="none" dot={false} /><Area type="monotone" dataKey="p" stroke="var(--cyan)" strokeWidth={2} fill="url(#gp2)" dot={false} /></AreaChart></ResponsiveContainer>;
  if (tab === 'rsi') return <ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><YAxis domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 11, borderRadius: 10 }} /><ReferenceLine y={70} stroke="var(--red)" strokeDasharray="3 3" /><ReferenceLine y={30} stroke="var(--green)" strokeDasharray="3 3" /><Area type="monotone" dataKey="rsi" stroke="var(--purple)" fill="rgba(124,77,255,.12)" dot={false} /></AreaChart></ResponsiveContainer>;
  if (tab === 'macd') return <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data}><XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 11, borderRadius: 10 }} /><Bar dataKey="macd_h" fill="var(--cyan)" /><Line type="monotone" dataKey="macd" stroke="var(--green)" dot={false} /><Line type="monotone" dataKey="macd_s" stroke="var(--orange)" dot={false} /></ComposedChart></ResponsiveContainer>;
  if (tab === 'adx') return <ResponsiveContainer width="100%" height="100%"><LineChart data={data}><XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><YAxis domain={[0, 60]} tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 11, borderRadius: 10 }} /><ReferenceLine y={25} stroke="var(--orange)" strokeDasharray="3 3" /><Line type="monotone" dataKey="adx" stroke="var(--orange)" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer>;
  return <ResponsiveContainer width="100%" height="100%"><BarChart data={data}><XAxis dataKey="t" tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><YAxis tick={{ fontSize: 9, fill: 'var(--text2)' }} tickLine={false} axisLine={false} /><Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 11, borderRadius: 10 }} /><Bar dataKey="v" fill="var(--cyan)" /></BarChart></ResponsiveContainer>;
}
