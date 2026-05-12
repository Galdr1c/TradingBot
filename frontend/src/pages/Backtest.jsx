import React, { useState, useEffect } from 'react';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from 'recharts';
import * as api from '../api';

export default function Backtest() {
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [symbol, setSymbol] = useState('BTC/USDT');

  const runBacktest = async () => {
    setLoading(true);
    try {
      // Assuming new endpoint or backend adjustment to return detailed equity curve
      const data = await api.runBacktest(symbol);
      setResults(data);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  return (
    <div className="col panel" style={{ padding: 20 }}>
      <div className="ph">■ ADVANCED BACKTEST ENGINE</div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input value={symbol} onChange={e => setSymbol(e.target.value)} className="input" placeholder="Symbol" />
        <button className="btn" onClick={runBacktest} disabled={loading}>
          {loading ? 'Running...' : 'Run Simulation'}
        </button>
      </div>

      {results && (
        <div className="grid grid-3">
          <div className="mc">
            <div className="ml">SHARPE RATIO</div>
            <div className="mv">{results.metrics.sharpe}</div>
          </div>
          <div className="mc">
            <div className="ml">MAX DRAWDOWN</div>
            <div className="mv" style={{color: 'var(--red)'}}>{results.metrics.max_drawdown}%</div>
          </div>
          <div className="mc">
            <div className="ml">FINAL VALUE</div>
            <div className="mv" style={{color: 'var(--green)'}}>${results.metrics.final_value}</div>
          </div>
        </div>
      )}

      {results && (
        <div style={{ height: 400, marginTop: 20 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={results.equity_curve}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis dataKey="date" hide />
              <YAxis domain={['auto', 'auto']} />
              <Tooltip contentStyle={{background:'#040810'}} />
              <Legend />
              <Line type="monotone" dataKey="equity" stroke="var(--cyan)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
