import React, { useState, useEffect, useCallback } from 'react';
import { Play, Pause, RefreshCw, Bot, TrendingUp, TrendingDown } from 'lucide-react';
import * as api from '../api';

const fmt = (n,d=2) => n!=null ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const colorOf = n => n>=0?'var(--green)':'var(--red)';

const STRATEGY_COLORS = {
  'RSI Mean Reversion': 'var(--cyan)',
  'EMA Crossover': 'var(--green)',
  'AI Forecast': 'var(--purple)',
  'Volatility Breakout': 'var(--orange)',
  'Sentiment NLP': '#ff79c6',
  'Bollinger Squeeze': 'var(--yellow)',
};

function WinRateBar({ pct }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div className="bar-track" style={{ flex:1 }}>
        <div className="bar-fill" style={{ width:`${pct}%`, background: pct>65?'var(--green)':pct>45?'var(--orange)':'var(--red)' }} />
      </div>
      <span style={{ fontSize:9, color:'var(--text2)', minWidth:30 }}>{fmt(pct,1)}%</span>
    </div>
  );
}

export default function Bots() {
  const [bots, setBots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBots(await api.getBots()); } catch(e){}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id) => {
    setToggling(id);
    try {
      const updated = await api.toggleBot(id);
      setBots(prev => prev.map(b => b.id === id ? updated : b));
    } catch(e){}
    setToggling(null);
  };

  const activeBots = bots.filter(b => b.status === 'active');
  const totalPnl = bots.reduce((s,b) => s + (b.pnl||0), 0);
  const totalTrades = bots.reduce((s,b) => s + (b.trades||0), 0);
  const avgWinrate = bots.length ? bots.reduce((s,b) => s + (b.winrate||0), 0) / bots.length : 0;

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {/* Summary */}
      <div className="g4">
        {[
          { label:'ACTIVE BOTS', val:`${activeBots.length} / ${bots.length}`, color:'var(--green)' },
          { label:'TOTAL BOT P&L', val:`${totalPnl>=0?'+':''}$${fmt(totalPnl)}`, color:colorOf(totalPnl) },
          { label:'TOTAL TRADES', val:totalTrades, color:'var(--cyan)' },
          { label:'AVG WIN RATE', val:`${fmt(avgWinrate,1)}%`, color: avgWinrate>60?'var(--green)':'var(--orange)' },
        ].map(m => (
          <div key={m.label} className="mc">
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color:m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Bots Grid */}
      <div className="g2" style={{ gap:10 }}>
        {loading && !bots.length ? (
          <div className="loading-cell" style={{ gridColumn:'1/-1' }}><RefreshCw size={14} className="spinner" /> Loading bots...</div>
        ) : bots.map(bot => (
          <div key={bot.id} className="panel" style={{ padding:16, gap:12 }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
              <div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <Bot size={14} color={STRATEGY_COLORS[bot.strategy] || 'var(--cyan)'} />
                  <span style={{ fontFamily:'Orbitron,sans-serif', fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:1 }}>{bot.name}</span>
                </div>
                <div style={{ fontSize:9, color:'var(--text2)' }}>{bot.symbol} · {bot.strategy}</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span className={`tag ${bot.status === 'active' ? 'active' : 'paused'}`}>{bot.status.toUpperCase()}</span>
                <button
                  className={`btn sm ${bot.status==='active'?'red':'green'}`}
                  onClick={() => toggle(bot.id)}
                  disabled={toggling === bot.id}
                >
                  {toggling===bot.id ? <RefreshCw size={9} className="spinner" /> : bot.status==='active' ? <Pause size={9} /> : <Play size={9} />}
                  {bot.status==='active' ? 'PAUSE' : 'START'}
                </button>
              </div>
            </div>

            <div className="g3" style={{ gap:8 }}>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:3 }}>P&L</div>
                <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color:colorOf(bot.pnl) }}>
                  {bot.pnl>=0?'+':''}${fmt(bot.pnl)}
                </div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:3 }}>TRADES</div>
                <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color:'var(--cyan)' }}>{bot.trades}</div>
              </div>
              <div style={{ textAlign:'center' }}>
                <div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:3 }}>WIN RATE</div>
                <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color: bot.winrate>60?'var(--green)':'var(--orange)' }}>
                  {fmt(bot.winrate,1)}%
                </div>
              </div>
            </div>

            <div>
              <div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1, marginBottom:4 }}>WIN RATE</div>
              <WinRateBar pct={bot.winrate} />
            </div>

            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:9, color:'var(--text2)' }}>
              <div style={{ width:6, height:6, borderRadius:'50%', background: bot.status==='active'?'var(--green)':'var(--orange)', boxShadow: bot.status==='active'?'0 0 6px var(--green)':'' }} />
              {bot.status==='active' ? 'Running' : 'Paused'} · Strategy: {bot.strategy}
            </div>
          </div>
        ))}
      </div>

      {/* Bot performance table */}
      <div className="panel">
        <div className="ph"><span className="ac">■</span> BOT PERFORMANCE SUMMARY</div>
        <div className="sc">
          <div style={{ padding:'4px 14px 0', borderBottom:'1px solid var(--border)' }}>
            <div className="bot-row" style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2 }}>
              <span>NAME</span><span>SYMBOL</span><span>STATUS</span><span>P&L</span><span>TRADES</span><span>WIN%</span><span>ACTION</span>
            </div>
          </div>
          {bots.map(bot => (
            <div key={bot.id} className="bot-row">
              <div>
                <div className="bot-name">{bot.name}</div>
                <div className="bot-strategy">{bot.strategy}</div>
              </div>
              <span style={{ color:'var(--text2)', fontSize:10 }}>{bot.symbol}</span>
              <span className={`tag ${bot.status==='active'?'active':'paused'}`}>{bot.status.toUpperCase()}</span>
              <span style={{ color:colorOf(bot.pnl), fontWeight:600, fontFamily:'Orbitron,sans-serif', fontSize:10 }}>
                {bot.pnl>=0?'+':''}${fmt(bot.pnl)}
              </span>
              <span style={{ color:'var(--text)', fontSize:10 }}>{bot.trades}</span>
              <span style={{ color: bot.winrate>60?'var(--green)':'var(--orange)', fontSize:10 }}>{fmt(bot.winrate,1)}%</span>
              <button className={`btn sm ${bot.status==='active'?'red':'green'}`} onClick={() => toggle(bot.id)} disabled={toggling===bot.id}>
                {bot.status==='active' ? 'PAUSE' : 'START'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
