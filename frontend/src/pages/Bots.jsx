import React, { useState, useEffect, useCallback } from 'react';
import { Play, Pause, RefreshCw, Bot, ShieldAlert } from 'lucide-react';
import * as api from '../api';
import { EmptyState, ErrorState, LoadingState } from '../components/AppShellUtils';

const fmt = (n,d=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const colorOf = n => Number(n)>=0?'var(--green)':'var(--red)';

const STRATEGY_COLORS = {
  'RSI Mean Reversion': 'var(--cyan)',
  'EMA Crossover': 'var(--green)',
  'AI Forecast': 'var(--purple)',
  'Volatility Breakout': 'var(--orange)',
  'Sentiment NLP': '#ff79c6',
  'Bollinger Squeeze': 'var(--yellow)',
};

function WinRateBar({ pct }) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div className="bar-track" style={{ flex:1 }}>
        <div className="bar-fill" style={{ width:`${p}%`, background: p>65?'var(--green)':p>45?'var(--orange)':'var(--red)' }} />
      </div>
      <span style={{ fontSize:9, color:'var(--text2)', minWidth:30 }}>{fmt(p,1)}%</span>
    </div>
  );
}

export default function Bots() {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [toggling, setToggling] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.getBots();
      setPayload(Array.isArray(res) ? { connected:true, bots:res } : res);
    } catch(e){ setError(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id) => {
    setToggling(id);
    try {
      await api.toggleBot(id);
      await load();
    } catch(e){ setError(e); }
    finally { setToggling(null); }
  };

  if (loading && !payload) return <LoadingState text="OpenTrader canlı botları kontrol ediliyor..." />;
  if (error && !payload) return <ErrorState error={error} onRetry={load} />;

  const bots = payload?.bots ?? [];
  const activeBots = bots.filter(b => b.status === 'active' || b.status === 'running');
  const totalPnl = bots.reduce((s,b) => s + (Number(b.pnl) || 0), 0);
  const totalTrades = bots.reduce((s,b) => s + (Number(b.trades) || 0), 0);
  const avgWinrate = bots.length ? bots.reduce((s,b) => s + (Number(b.winrate) || 0), 0) / bots.length : null;

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {!payload?.connected && (
        <div className="panel live-empty-banner">
          <ShieldAlert size={18} color="var(--orange)" />
          <div><strong>Bot mock verisi kapalı.</strong><span>{payload?.message || 'OpenTrader canlı bot listesi döndürmedi; sahte P&L, işlem sayısı veya win-rate gösterilmiyor.'}</span></div>
          <button className="btn sm" onClick={load} disabled={loading}><RefreshCw size={10} className={loading?'spinner':''} /> Kontrol et</button>
        </div>
      )}

      <div className="g4">
        {[
          { label:'ACTIVE BOTS', val:`${activeBots.length} / ${bots.length}`, color:'var(--green)' },
          { label:'TOTAL BOT P&L', val:bots.length ? `${totalPnl>=0?'+':''}$${fmt(totalPnl)}` : '—', color:colorOf(totalPnl) },
          { label:'TOTAL TRADES', val:bots.length ? totalTrades : '—', color:'var(--cyan)' },
          { label:'AVG WIN RATE', val:avgWinrate == null ? '—' : `${fmt(avgWinrate,1)}%`, color: avgWinrate>60?'var(--green)':'var(--orange)' },
        ].map(m => (
          <div key={m.label} className="mc"><div className="ml">{m.label}</div><div className="mv" style={{ color:m.color }}>{m.val}</div></div>
        ))}
      </div>

      {bots.length ? (
        <>
          <div className="g2" style={{ gap:10 }}>
            {bots.map(bot => (
              <div key={bot.id || bot.name} className="panel" style={{ padding:16, gap:12 }}>
                <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                      <Bot size={14} color={STRATEGY_COLORS[bot.strategy] || 'var(--cyan)'} />
                      <span style={{ fontFamily:'Orbitron,sans-serif', fontSize:10, fontWeight:700, color:'var(--text3)', letterSpacing:1 }}>{bot.name || bot.id}</span>
                    </div>
                    <div style={{ fontSize:9, color:'var(--text2)' }}>{bot.symbol || bot.pair} · {bot.strategy}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span className={`tag ${(bot.status === 'active' || bot.status === 'running') ? 'active' : 'paused'}`}>{String(bot.status || 'unknown').toUpperCase()}</span>
                    <button className={`btn sm ${(bot.status === 'active' || bot.status === 'running')?'red':'green'}`} onClick={() => toggle(bot.id)} disabled={toggling === bot.id || !bot.id}>
                      {toggling===bot.id ? <RefreshCw size={9} className="spinner" /> : (bot.status === 'active' || bot.status === 'running') ? <Pause size={9} /> : <Play size={9} />}
                      {(bot.status === 'active' || bot.status === 'running') ? 'PAUSE' : 'START'}
                    </button>
                  </div>
                </div>

                <div className="g3" style={{ gap:8 }}>
                  <div style={{ textAlign:'center' }}><div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:3 }}>P&L</div><div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color:colorOf(bot.pnl) }}>{Number(bot.pnl)>=0?'+':''}${fmt(bot.pnl)}</div></div>
                  <div style={{ textAlign:'center' }}><div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:3 }}>TRADES</div><div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color:'var(--cyan)' }}>{bot.trades ?? '—'}</div></div>
                  <div style={{ textAlign:'center' }}><div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.2, marginBottom:3 }}>WIN RATE</div><div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color: Number(bot.winrate)>60?'var(--green)':'var(--orange)' }}>{fmt(bot.winrate,1)}%</div></div>
                </div>
                <div><div style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1, marginBottom:4 }}>WIN RATE</div><WinRateBar pct={bot.winrate} /></div>
              </div>
            ))}
          </div>
        </>
      ) : <div className="panel"><EmptyState title="Canlı bot yok" text="OpenTrader gerçek bot listesi dönmedi. Mock bot kartları kaldırıldı." action={<button className="btn sm" onClick={load}>Yenile</button>} /></div>}
    </div>
  );
}
