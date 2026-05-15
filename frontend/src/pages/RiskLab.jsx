import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Calculator, RefreshCw, ShieldCheck, GitBranch } from 'lucide-react';
import * as api from '../api';
import { EmptyState, ErrorState, LoadingState, useToast } from '../components/AppShellUtils';

const fmt = (n, d = 2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
const STRATEGIES = ['rsi', 'ema_cross', 'macd', 'grid'];

function HeatMap({ corr }) {
  const symbols = corr?.symbols || [];
  if (!symbols.length || !corr?.matrix?.length) return <EmptyState title="Korelasyon yok" text={corr?.warning || 'En az iki sembol gerekli.'} />;
  return <div className="heatmap" style={{ gridTemplateColumns: `120px repeat(${symbols.length}, minmax(64px, 1fr))` }}>
    <div />{symbols.map(s => <div className="heat-head" key={s}>{s}</div>)}
    {symbols.map((row, i) => <React.Fragment key={row}>
      <div className="heat-head row">{row}</div>
      {symbols.map((col, j) => {
        const v = Number(corr.matrix[i]?.[j] || 0);
        const alpha = Math.min(0.9, Math.abs(v));
        const color = v >= 0 ? `rgba(34,197,94,${0.12 + alpha * 0.55})` : `rgba(251,113,133,${0.12 + alpha * 0.55})`;
        return <div key={`${row}-${col}`} className="heat-cell" style={{ background: color }}>{v.toFixed(2)}</div>;
      })}
    </React.Fragment>)}
  </div>;
}

function Metric({ label, value, tone }) {
  return <div className="risk-card"><span>{label}</span><strong className={tone || ''}>{value}</strong></div>;
}

export default function RiskLab() {
  const { notify } = useToast();
  const [symbols, setSymbols] = useState(api.DEFAULT_SYMBOLS);
  const [corr, setCorr] = useState(null);
  const [corrLoading, setCorrLoading] = useState(false);
  const [corrError, setCorrError] = useState(null);
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [equity, setEquity] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);
  const [position, setPosition] = useState(null);
  const [strategy, setStrategy] = useState('rsi');
  const [backtest, setBacktest] = useState(null);
  const [validation, setValidation] = useState(null);
  const [btLoading, setBtLoading] = useState(false);

  const loadCorr = useCallback(async () => {
    setCorrLoading(true); setCorrError(null);
    try { setCorr(await api.getCorrelation(symbols, '1d', 160)); }
    catch (e) { setCorrError(e); notify(e.message, 'error'); }
    finally { setCorrLoading(false); }
  }, [symbols, notify]);

  const calcPosition = async () => {
    try { setPosition(await api.getPositionSize(symbol, '1h', equity, riskPct, 2, 25)); }
    catch (e) { notify(e.message, 'error'); }
  };

  const runBacktest = async (validate = false) => {
    setBtLoading(true);
    try {
      if (validate) setValidation(await api.validateBacktest(symbol, strategy, '1h', 1000, 4));
      else setBacktest(await api.runAdvancedBacktest(symbol, strategy, '1h', 900, { initial_cash: equity }));
    } catch (e) { notify(e.message, 'error'); }
    setBtLoading(false);
  };

  useEffect(() => { loadCorr(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { calcPosition(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const highPairs = useMemo(() => (corr?.pairs || []).filter(x => Math.abs(x.corr) >= 0.65).slice(0, 4), [corr]);
  const m = backtest?.metrics || {};

  return <div className="col fade-in" style={{ gap: 14 }}>
    <div className="panel">
      <div className="ph"><span className="ac">■</span> RISK / VALIDATION LAB</div>
      <div className="panel-pad research-toolbar">
        <div className="wide-input"><Activity size={15} /><input value={symbols} onChange={e => setSymbols(e.target.value)} placeholder="BTC/USDT,ETH/USDT,AAPL..." /></div>
        <button className="btn" type="button" onClick={loadCorr} disabled={corrLoading}><RefreshCw size={13} className={corrLoading ? 'spinner' : ''} /> Korelasyon yenile</button>
      </div>
    </div>

    <div className="panel">
      <div className="ph"><span className="ag">■</span> CORRELATION HEATMAP</div>
      <div className="panel-pad">
        {corrLoading ? <LoadingState text="Korelasyon hesaplanıyor..." /> : corrError ? <ErrorState error={corrError} onRetry={loadCorr} /> : <HeatMap corr={corr} />}
        {highPairs.length > 0 && <div className="pair-strip">{highPairs.map(p => <span key={`${p.a}-${p.b}`}>{p.a} ↔ {p.b}: {p.corr}</span>)}</div>}
      </div>
    </div>

    <div className="g2 lab-split">
      <div className="panel">
        <div className="ph"><span className="aa">■</span> ATR POSITION SIZER</div>
        <div className="panel-pad col" style={{ gap: 12 }}>
          <div className="form-grid">
            <label>Sembol<input className="input" value={symbol} onChange={e => setSymbol(e.target.value)} /></label>
            <label>Hesap($)<input className="input" type="number" value={equity} onChange={e => setEquity(e.target.value)} /></label>
            <label>Risk %<input className="input" type="number" value={riskPct} onChange={e => setRiskPct(e.target.value)} /></label>
          </div>
          <button className="btn" type="button" onClick={calcPosition}><Calculator size={13} /> Pozisyonu hesapla</button>
          {position && <div className="risk-grid">
            <Metric label="Quantity" value={fmt(position.quantity, 6)} />
            <Metric label="Notional" value={`$${fmt(position.notional)}`} />
            <Metric label="Long Stop" value={`$${fmt(position.long_stop)}`} />
            <Metric label="ATR" value={`${fmt(position.atr_pct, 2)}%`} />
          </div>}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="ap">■</span> BACKTEST GUARDRAILS</div>
        <div className="panel-pad col" style={{ gap: 12 }}>
          <div className="form-grid two">
            <label>Strateji<select value={strategy} onChange={e => setStrategy(e.target.value)}>{STRATEGIES.map(s => <option key={s} value={s}>{s}</option>)}</select></label>
            <label>Sembol<input className="input" value={symbol} onChange={e => setSymbol(e.target.value)} /></label>
          </div>
          <div className="action-row"><button className="btn" onClick={() => runBacktest(false)} disabled={btLoading}><GitBranch size={13} /> Backtest</button><button className="btn ghost" onClick={() => runBacktest(true)} disabled={btLoading}><ShieldCheck size={13} /> Walk-forward validate</button></div>
          {btLoading && <LoadingState text="Test çalışıyor..." />}
          {backtest && <div className="risk-grid">
            <Metric label="Return" value={`${fmt(m.return_pct)}%`} tone={Number(m.return_pct) >= 0 ? 'pos' : 'neg'} />
            <Metric label="Max DD" value={`${fmt(m.max_drawdown)}%`} tone="neg" />
            <Metric label="Sharpe" value={fmt(m.sharpe, 3)} />
            <Metric label="Win Rate" value={`${fmt(m.win_rate)}%`} />
          </div>}
          {validation && <div className="repo-card"><div className="repo-title">{validation.summary?.interpretation} · {validation.summary?.pass_rate_pct}% pass</div><p>Ortalama fold getirisi: {fmt(validation.summary?.avg_return_pct)}%</p><div className="fold-list">{(validation.folds || []).map(f => <span key={f.fold}>F{f.fold}: {fmt(f.return_pct)}% / DD {fmt(f.max_drawdown)}%</span>)}</div></div>}
        </div>
      </div>
    </div>
  </div>;
}
