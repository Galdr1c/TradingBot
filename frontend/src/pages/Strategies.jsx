import React, { useState, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, AreaChart, Area } from 'recharts';
import { Grid3X3, TrendingDown, Activity, Play, RefreshCw, Zap, ChevronRight, AlertCircle } from 'lucide-react';
import * as api from '../api';

const fmt = (n, d = 2) => n != null ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const colorOf = n => n >= 0 ? 'var(--green)' : 'var(--red)';

// ── Strategy tabs ────────────────────────────────────────────────────────────
const STRATEGIES = [
  { id: 'grid', label: 'GRID BOT', icon: Grid3X3, color: 'var(--cyan)',
    desc: 'Profits from market fluctuations — grid of buy/sell orders in a price range.' },
  { id: 'dca',  label: 'DCA BOT',  icon: TrendingDown, color: 'var(--green)',
    desc: 'Dollar Cost Averaging — multiple orders to average entry price, sell on swing.' },
  { id: 'rsi',  label: 'RSI BOT',  icon: Activity, color: 'var(--purple)',
    desc: 'Places orders based on RSI indicator crossovers — OpenTrader RSI strategy.' },
];

const SYMBOLS = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'AAPL', 'NVDA', 'TSLA'];
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'];

// ── Param input row ──────────────────────────────────────────────────────────
function ParamRow({ label, value, onChange, type = 'number', step, min, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text2)', letterSpacing: 1, textTransform: 'uppercase' }}>{label}</span>
        {hint && <span style={{ fontSize: 8, color: 'var(--text2)', opacity: 0.7 }}>{hint}</span>}
      </div>
      <input
        type={type}
        value={value}
        step={step}
        min={min}
        onChange={e => onChange(type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value)}
        style={{
          background: 'rgba(255,255,255,0.04)', border: '1px solid var(--panel-border)',
          color: 'var(--text-bright)', fontFamily: 'var(--font-mono)', fontSize: 12,
          padding: '8px 12px', borderRadius: 6, outline: 'none', width: '100%',
          transition: 'border-color .2s',
        }}
        onFocus={e => e.target.style.borderColor = 'var(--cyan)'}
        onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.08)'}
      />
    </div>
  );
}

// ── Metric pill ──────────────────────────────────────────────────────────────
function Metric({ label, value, color }) {
  return (
    <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid var(--panel-border)',
      borderRadius: 8, padding: '10px 16px', textAlign: 'center' }}>
      <div style={{ fontSize: 9, color: 'var(--text2)', letterSpacing: 1, marginBottom: 5 }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 700, color: color || 'var(--text-bright)' }}>{value}</div>
    </div>
  );
}

// ── Grid Bot panel ────────────────────────────────────────────────────────────
function GridPanel({ symbol, onResult }) {
  const [params, setParams] = useState({ highPrice: 72000, lowPrice: 58000, gridLevels: 20, quantityPerGrid: 0.001 });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const p = k => v => setParams(prev => ({ ...prev, [k]: v }));

  const run = useCallback(async (mode) => {
    setLoading(true);
    try {
      const res = await api.runOpenTraderStrategy('grid', symbol, {
        ...params, currentPrice: (params.highPrice + params.lowPrice) / 2, mode,
      });
      setResult(res);
      onResult && onResult(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [params, symbol, onResult]);

  const step = result?.step_size ?? 0;
  const gridPrices = result?.grid_prices ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* Config */}
      <div className="panel">
        <div className="ph"><span className="ac">■</span> GRID CONFIGURATION — {symbol}</div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ParamRow label="High Price ($)" value={params.highPrice} onChange={p('highPrice')} step={100} min={0} hint="Upper grid boundary" />
          <ParamRow label="Low Price ($)" value={params.lowPrice} onChange={p('lowPrice')} step={100} min={0} hint="Lower grid boundary" />
          <ParamRow label="Grid Levels" value={params.gridLevels} onChange={p('gridLevels')} step={1} min={2} hint="Number of orders" />
          <ParamRow label="Qty per Grid" value={params.quantityPerGrid} onChange={p('quantityPerGrid')} step={0.001} min={0.0001} hint="Base currency amount" />
        </div>
        <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => run('preview')} disabled={loading}
            style={{ flex: 1, background: 'rgba(0,212,255,0.1)', borderColor: 'rgba(0,212,255,0.3)', color: 'var(--cyan)' }}>
            {loading ? <RefreshCw size={11} className="spinner" /> : <Zap size={11} />} CALCULATE GRID
          </button>
          <button className="btn" onClick={() => run('paper')} disabled={loading}
            style={{ flex: 1, background: 'rgba(0,232,122,0.1)', borderColor: 'rgba(0,232,122,0.3)', color: 'var(--green)' }}>
            <Play size={11} /> PAPER TRADE
          </button>
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            <Metric label="STEP SIZE" value={`$${fmt(result.step_size)}`} color="var(--cyan)" />
            <Metric label="PROFIT/GRID" value={`$${fmt(result.profit_per_grid)}`} color="var(--green)" />
            <Metric label="GRID ROI" value={`${fmt(result.grid_roi_pct, 4)}%`} color="var(--orange)" />
            <Metric label="INVESTMENT" value={`$${fmt(result.total_investment)}`} color="var(--text-bright)" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {/* Buy orders */}
            <div className="panel">
              <div className="ph"><span className="ag">■</span> NEAREST BUY ORDERS</div>
              <div style={{ padding: 12 }}>
                {(result.buy_orders || []).slice().reverse().map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px',
                    background: 'rgba(16,185,129,0.05)', borderRadius: 4, marginBottom: 4,
                    border: '1px solid rgba(16,185,129,0.2)' }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)' }}>BUY #{i + 1}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--green)' }}>${fmt(p)}</span>
                  </div>
                ))}
              </div>
            </div>
            {/* Sell orders */}
            <div className="panel">
              <div className="ph"><span className="aa">■</span> NEAREST SELL ORDERS</div>
              <div style={{ padding: 12 }}>
                {(result.sell_orders || []).map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 8px',
                    background: 'rgba(239,68,68,0.05)', borderRadius: 4, marginBottom: 4,
                    border: '1px solid rgba(239,68,68,0.2)' }}>
                    <span style={{ fontSize: 10, color: 'var(--text2)' }}>SELL #{i + 1}</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--red)' }}>${fmt(p)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Visual grid */}
          {gridPrices.length > 0 && (
            <div className="panel">
              <div className="ph"><span className="ac">■</span> GRID VISUALISER</div>
              <div style={{ height: 200, padding: '8px 4px' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={gridPrices.map((p, i) => ({ i, price: p }))} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="i" hide />
                    <YAxis domain={[params.lowPrice * 0.99, params.highPrice * 1.01]} tick={{ fontSize: 9, fill: 'var(--text2)' }}
                      tickLine={false} axisLine={false} width={65} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                    <Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 10, borderRadius: 4 }}
                      formatter={v => [`$${fmt(v)}`, 'Grid level']} />
                    {gridPrices.map((p, i) => (
                      <ReferenceLine key={i} y={p}
                        stroke={p < (params.highPrice + params.lowPrice) / 2 ? 'rgba(16,185,129,0.4)' : 'rgba(239,68,68,0.4)'}
                        strokeDasharray="3 3" />
                    ))}
                    <Line type="monotone" dataKey="price" stroke="var(--cyan)" strokeWidth={1.5} dot={{ r: 2, fill: 'var(--cyan)' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── DCA Bot panel ─────────────────────────────────────────────────────────────
function DCAPanel({ symbol }) {
  const [params, setParams] = useState({ entryPrice: 65000, dropPct: 3, orders: 5, baseQty: 0.001, multiplier: 1.5, takeProfitPct: 2 });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const p = k => v => setParams(prev => ({ ...prev, [k]: v }));

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.runOpenTraderStrategy('dca', symbol, params);
      setResult(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [params, symbol]);

  const orders = result?.orders ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="panel">
        <div className="ph"><span className="ag">■</span> DCA CONFIGURATION — {symbol}</div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ParamRow label="Entry Price ($)" value={params.entryPrice} onChange={p('entryPrice')} step={100} hint="First buy price" />
          <ParamRow label="Drop % per Order" value={params.dropPct} onChange={p('dropPct')} step={0.5} min={0.1} hint="Price drop between orders" />
          <ParamRow label="Number of Orders" value={params.orders} onChange={p('orders')} step={1} min={2} max={10} hint="Max 10" />
          <ParamRow label="Base Quantity" value={params.baseQty} onChange={p('baseQty')} step={0.001} min={0.0001} hint="First order size" />
          <ParamRow label="Size Multiplier" value={params.multiplier} onChange={p('multiplier')} step={0.1} min={1} hint="Each order × multiplier" />
          <ParamRow label="Take Profit %" value={params.takeProfitPct} onChange={p('takeProfitPct')} step={0.5} min={0.1} hint="Target profit from avg entry" />
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <button className="btn" onClick={run} disabled={loading}
            style={{ width: '100%', background: 'rgba(0,232,122,0.1)', borderColor: 'rgba(0,232,122,0.3)', color: 'var(--green)' }}>
            {loading ? <RefreshCw size={11} className="spinner" /> : <Zap size={11} />} CALCULATE DCA PLAN
          </button>
        </div>
      </div>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
            <Metric label="AVG ENTRY" value={`$${fmt(result.avg_entry)}`} color="var(--cyan)" />
            <Metric label="TAKE PROFIT" value={`$${fmt(result.take_profit)}`} color="var(--green)" />
            <Metric label="EXPECTED PROFIT" value={`$${fmt(result.expected_profit)}`} color="var(--green)" />
            <Metric label="TOTAL INVESTMENT" value={`$${fmt(result.total_investment)}`} color="var(--text-bright)" />
          </div>

          <div className="panel">
            <div className="ph"><span className="ag">■</span> ORDER PLAN</div>
            <table className="tbl">
              <thead><tr><th>#</th><th>PRICE</th><th>QUANTITY</th><th>ORDER VALUE</th><th>CUMULATIVE</th></tr></thead>
              <tbody>
                {orders.map((o, i) => {
                  const cumCost = orders.slice(0, i + 1).reduce((s, x) => s + x.price * x.qty, 0);
                  return (
                    <tr key={i}>
                      <td style={{ color: 'var(--text2)' }}>#{i + 1}</td>
                      <td style={{ color: 'var(--red)', fontFamily: 'var(--font-display)', fontSize: 11 }}>${fmt(o.price)}</td>
                      <td style={{ color: 'var(--text)' }}>{o.qty.toFixed(6)}</td>
                      <td style={{ color: 'var(--text2)' }}>${fmt(o.price * o.qty)}</td>
                      <td style={{ color: 'var(--orange)' }}>${fmt(cumCost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── RSI Bot panel ─────────────────────────────────────────────────────────────
function RSIPanel({ symbol }) {
  const [params, setParams] = useState({ oversold: 30, overbought: 70, period: 14, qty: 0.001 });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const p = k => v => setParams(prev => ({ ...prev, [k]: v }));

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.runOpenTraderStrategy('rsi', symbol, params);
      setResult(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [params, symbol]);

  const sigColor = result?.signal === 'BUY' ? 'var(--green)' : result?.signal === 'SELL' ? 'var(--red)' : 'var(--orange)';

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="panel">
        <div className="ph"><span className="ap">■</span> RSI STRATEGY — {symbol}</div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <ParamRow label="RSI Period" value={params.period} onChange={p('period')} step={1} min={2} hint="Wilder RSI period" />
          <ParamRow label="Order Quantity" value={params.qty} onChange={p('qty')} step={0.001} min={0.0001} />
          <ParamRow label="Oversold Level" value={params.oversold} onChange={p('oversold')} step={1} min={10} max={40} hint="Buy signal below this" />
          <ParamRow label="Overbought Level" value={params.overbought} onChange={p('overbought')} step={1} min={60} max={90} hint="Sell signal above this" />
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <button className="btn" onClick={run} disabled={loading}
            style={{ width: '100%', background: 'rgba(168,85,247,0.1)', borderColor: 'rgba(168,85,247,0.3)', color: 'var(--purple)' }}>
            {loading ? <RefreshCw size={11} className="spinner" /> : <Activity size={11} />} EVALUATE RSI SIGNAL
          </button>
        </div>
      </div>

      {result && (
        <div className="panel">
          <div className="ph"><span className="ap">■</span> RSI SIGNAL</div>
          <div style={{ padding: 20, display: 'flex', gap: 20, alignItems: 'flex-start' }}>
            <div style={{ textAlign: 'center', minWidth: 140 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 900, color: sigColor }}>{result.signal}</div>
              <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 4 }}>RSI: {result.rsi}</div>
              <div style={{ fontSize: 9, color: 'var(--text2)', marginTop: 2 }}>{params.oversold} ← range → {params.overbought}</div>
              <div className="conf-bar" style={{ marginTop: 8 }}>
                <div className="conf-fill" style={{ width: `${result.confidence}%`, background: sigColor }} />
              </div>
              <div style={{ fontSize: 8, color: 'var(--text2)', marginTop: 2 }}>{result.confidence}% confidence</div>
            </div>
            <div style={{ flex: 1, fontSize: 11, color: 'var(--text)', lineHeight: 1.7 }}>
              {result.analysis}
              <div style={{ marginTop: 12, padding: '8px 12px', background: 'rgba(255,255,255,0.03)',
                borderRadius: 6, border: '1px solid var(--panel-border)', fontSize: 10, color: 'var(--text2)' }}>
                <strong style={{ color: 'var(--purple)' }}>OpenTrader RSI Strategy:</strong> Enter when RSI crosses above oversold ({params.oversold}).
                Exit when RSI crosses into overbought ({params.overbought}). Same logic as{' '}
                <code style={{ color: 'var(--cyan)', fontSize: 9 }}>opentrader trade rsi</code>.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Backtest panel ─────────────────────────────────────────────────────────────
function BacktestPanel({ symbol }) {
  const [strategy, setStrategy] = useState('grid');
  const [timeframe, setTimeframe] = useState('1h');
  const [fromDate, setFromDate] = useState('2024-01-01');
  const [toDate, setToDate] = useState('2024-06-01');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.runOpenTraderBacktest(strategy, symbol, timeframe, fromDate, toDate);
      setResult(res);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [strategy, symbol, timeframe, fromDate, toDate]);

  const metrics = result?.metrics ?? {};
  const equityCurve = result?.equity_curve ?? [];

  return (
    <div className="col" style={{ gap: 16 }}>
      {/* Info banner */}
      <div style={{ padding: '10px 16px', background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
        borderRadius: 8, display: 'flex', gap: 10, alignItems: 'center', fontSize: 10, color: 'var(--text2)' }}>
        <AlertCircle size={14} color="var(--cyan)" />
        For highest accuracy, install OpenTrader CLI:{' '}
        <code style={{ color: 'var(--cyan)' }}>npm install -g opentrader</code>. Falls back to Python simulation.
      </div>

      <div className="panel">
        <div className="ph"><span className="aa">■</span> BACKTEST CONFIGURATION</div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
          <div className="col" style={{ gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--text2)', letterSpacing: 1 }}>STRATEGY</span>
            <select value={strategy} onChange={e => setStrategy(e.target.value)}>
              <option value="grid">Grid Bot</option>
              <option value="dca">DCA Bot</option>
              <option value="rsi">RSI Bot</option>
            </select>
          </div>
          <div className="col" style={{ gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--text2)', letterSpacing: 1 }}>TIMEFRAME</span>
            <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="col" style={{ gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--text2)', letterSpacing: 1 }}>FROM DATE</span>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-bright)', padding: '6px 12px', borderRadius: 8, fontSize: 11 }} />
          </div>
          <div className="col" style={{ gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--text2)', letterSpacing: 1 }}>TO DATE</span>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(255,255,255,0.08)',
                color: 'var(--text-bright)', padding: '6px 12px', borderRadius: 8, fontSize: 11 }} />
          </div>
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <button className="btn" onClick={run} disabled={loading}
            style={{ width: '100%', background: 'rgba(245,158,11,0.1)', borderColor: 'rgba(245,158,11,0.3)', color: 'var(--orange)' }}>
            {loading ? <RefreshCw size={11} className="spinner" /> : <Zap size={11} />}
            {loading ? 'RUNNING BACKTEST...' : `RUN ${strategy.toUpperCase()} BACKTEST ON ${symbol}`}
          </button>
        </div>
      </div>

      {result && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            <Metric label="TOTAL PROFIT" value={`$${fmt(metrics.total_profit ?? metrics.final_equity - 10000)}`}
              color={colorOf(metrics.total_profit ?? 0)} />
            <Metric label="WIN RATE" value={`${fmt(metrics.win_rate ?? 0)}%`}
              color={(metrics.win_rate ?? 0) > 55 ? 'var(--green)' : 'var(--orange)'} />
            <Metric label="MAX DRAWDOWN" value={`${fmt(metrics.max_dd ?? 0)}%`} color="var(--red)" />
            <Metric label="TOTAL TRADES" value={metrics.trades ?? 0} color="var(--cyan)" />
            <Metric label="SHARPE RATIO" value={fmt(metrics.sharpe ?? 0, 3)} color="var(--purple)" />
            <Metric label="PROFIT %" value={`${fmt(metrics.profit_pct ?? 0)}%`}
              color={colorOf(metrics.profit_pct ?? 0)} />
          </div>

          {equityCurve.length > 0 && (
            <div className="panel" style={{ minHeight: 260 }}>
              <div className="ph">
                <span className="aa">■</span> EQUITY CURVE
                {result.source && <span style={{ marginLeft: 8, fontSize: 8, color: 'var(--text2)' }}>source: {result.source}</span>}
              </div>
              <div style={{ flex: 1, padding: '8px 4px' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={equityCurve} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="geq" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--green)" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="var(--green)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="i" hide />
                    <YAxis domain={['auto', 'auto']} tick={{ fontSize: 8, fill: 'var(--text2)' }}
                      tickLine={false} axisLine={false} width={65} tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                    <Tooltip contentStyle={{ background: '#040810', border: '1px solid #0f2040', fontSize: 10, borderRadius: 4 }}
                      formatter={v => [`$${fmt(v)}`, 'Equity']} />
                    <ReferenceLine y={10000} stroke="rgba(255,255,255,0.1)" strokeDasharray="4 4" />
                    <Area type="monotone" dataKey="equity" stroke="var(--green)" strokeWidth={1.5} fill="url(#geq)" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {result.note && (
            <div style={{ padding: '8px 14px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
              borderRadius: 6, fontSize: 9, color: 'var(--orange)' }}>
              ⚠ {result.note}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function Strategies() {
  const [strategy, setStrategy] = useState('grid');
  const [btMode, setBtMode] = useState(false);
  const [symbol, setSymbol] = useState('BTC/USDT');
  const active = STRATEGIES.find(s => s.id === strategy);

  return (
    <div className="col fade-in" style={{ gap: 10 }}>
      {/* Header */}
      <div className="panel">
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
              color: 'var(--text-bright)', letterSpacing: 2, marginBottom: 3 }}>
              OPENTRADER STRATEGIES
            </div>
            <div style={{ fontSize: 9, color: 'var(--text2)' }}>
              Powered by{' '}
              <a href="https://github.com/Open-Trader/opentrader" target="_blank" rel="noopener noreferrer"
                style={{ color: 'var(--cyan)', textDecoration: 'none' }}>
                github.com/Open-Trader/opentrader
              </a>
              {' '}· GRID · DCA · RSI · Backtest
            </div>
          </div>
          <select value={symbol} onChange={e => setSymbol(e.target.value)} style={{ width: 130 }}>
            {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn sm" onClick={() => setBtMode(!btMode)}
            style={{ background: btMode ? 'rgba(245,158,11,0.15)' : '', borderColor: btMode ? 'rgba(245,158,11,0.4)' : '',
              color: btMode ? 'var(--orange)' : '' }}>
            {btMode ? '← STRATEGIES' : 'BACKTEST →'}
          </button>
        </div>
      </div>

      {!btMode ? (
        <>
          {/* Strategy selector */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
            {STRATEGIES.map(s => {
              const Icon = s.icon;
              const isActive = s.id === strategy;
              return (
                <div key={s.id} onClick={() => setStrategy(s.id)}
                  style={{ padding: '14px 18px', borderRadius: 10, cursor: 'pointer',
                    background: isActive ? `rgba(${s.color === 'var(--cyan)' ? '0,212,255' : s.color === 'var(--green)' ? '16,185,129' : '168,85,247'},0.08)` : 'rgba(15,23,42,0.5)',
                    border: `1px solid ${isActive ? s.color.replace('var(--', 'rgba(').replace(')', ',0.4)').replace('cyan', '0,212,255').replace('green', '16,185,129').replace('purple', '168,85,247') : 'rgba(255,255,255,0.06)'}`,
                    transition: 'all .25s', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{ width: 36, height: 36, borderRadius: 8, display: 'flex', alignItems: 'center',
                    justifyContent: 'center', background: `rgba(${s.color === 'var(--cyan)' ? '0,212,255' : s.color === 'var(--green)' ? '16,185,129' : '168,85,247'},0.12)` }}>
                    <Icon size={17} color={s.color} />
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
                      color: isActive ? s.color : 'var(--text-bright)', letterSpacing: .5, marginBottom: 3 }}>
                      {s.label}
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--text2)', lineHeight: 1.5 }}>{s.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {strategy === 'grid' && <GridPanel symbol={symbol} />}
          {strategy === 'dca' && <DCAPanel symbol={symbol} />}
          {strategy === 'rsi' && <RSIPanel symbol={symbol} />}
        </>
      ) : (
        <BacktestPanel symbol={symbol} />
      )}
    </div>
  );
}
