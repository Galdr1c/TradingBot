import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { RefreshCw, ShieldAlert } from 'lucide-react';
import * as api from '../api';
import { EmptyState, ErrorState, LoadingState } from '../components/AppShellUtils';

const fmt = (n,d=2) => Number.isFinite(Number(n)) ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const colorOf = n => Number(n)>=0?'var(--green)':'var(--red)';

const PIE_COLORS = ['#00d4ff','#00e87a','#7c4dff','#ffaa00','#ff2d55','#ffe066'];

export default function Portfolio() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { setPortfolio(await api.getPortfolio()); }
    catch(e){ setError(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  const positions = portfolio?.positions ?? [];
  const history = portfolio?.history ?? [];
  const totalVal = portfolio?.total_value;
  const totalPnl = portfolio?.total_pnl;
  const totalPnlPct = portfolio?.total_pnl_pct;
  const cash = portfolio?.cash;

  const pieData = positions
    .filter(p => Number(p.market_value) > 0)
    .map((p, i) => ({ name: p.symbol, value: Number(p.market_value), fill: PIE_COLORS[i % PIE_COLORS.length] }));
  if (Number(cash) > 0) pieData.push({ name: 'CASH', value: Number(cash), fill: '#2a4060' });

  if (loading && !portfolio) return <LoadingState text="Canlı portföy bağlantısı kontrol ediliyor..." />;
  if (error) return <ErrorState error={error} onRetry={load} />;

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {!portfolio?.connected && (
        <div className="panel live-empty-banner">
          <ShieldAlert size={18} color="var(--orange)" />
          <div>
            <strong>Portföy mock verisi kapalı.</strong>
            <span>{portfolio?.message || 'Gerçek exchange/broker hesabı bağlanana kadar bakiye, pozisyon ve P&L gösterilmeyecek.'}</span>
          </div>
          <button className="btn sm" onClick={load} disabled={loading}><RefreshCw size={10} className={loading?'spinner':''} /> Kontrol et</button>
        </div>
      )}

      <div className="g4">
        {[
          { label:'TOTAL VALUE', val: totalVal == null ? '—' : `$${fmt(totalVal)}`, color:'var(--cyan)' },
          { label:'TOTAL P&L', val: totalPnl == null ? '—' : `${Number(totalPnl)>=0?'+':''}$${fmt(totalPnl)}`, color:colorOf(totalPnl) },
          { label:'P&L %', val: totalPnlPct == null ? '—' : `${Number(totalPnlPct)>=0?'+':''}${fmt(totalPnlPct)}%`, color:colorOf(totalPnlPct) },
          { label:'CASH', val: cash == null ? '—' : `$${fmt(cash)}`, color:'var(--text3)' },
        ].map(m => (
          <div key={m.label} className="mc">
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color:m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:10, height:240 }}>
        <div className="panel glow-cyan">
          <div className="ph"><span className="ac">■</span> PORTFOLIO VALUE · LIVE ACCOUNT HISTORY</div>
          <div className="chart-area">
            {history.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={history} margin={{top:4,right:4,left:0,bottom:0}}>
                  <defs><linearGradient id="gpv" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--green)" stopOpacity={0.25}/><stop offset="95%" stopColor="var(--green)" stopOpacity={0}/></linearGradient></defs>
                  <XAxis dataKey="timestamp" tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis domain={['auto','auto']} tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} width={60} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                  <Tooltip contentStyle={{background:'#040810',border:'1px solid #0f2040',fontSize:10,borderRadius:4}} formatter={v=>[`$${fmt(v)}`,'Value']} />
                  <Area type="monotone" dataKey="value" stroke="var(--green)" strokeWidth={1.5} fill="url(#gpv)" dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyState title="Canlı portföy geçmişi yok" text="Mock grafik üretimi kapalı. Broker/exchange geçmişi bağlandığında burada görünür." />}
          </div>
        </div>

        <div className="panel">
          <div className="ph"><span className="ag">■</span> ALLOCATION</div>
          {pieData.length ? (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:8 }}>
              <PieChart width={140} height={140}>
                <Pie data={pieData} cx={65} cy={65} innerRadius={38} outerRadius={60} paddingAngle={2} dataKey="value">
                  {pieData.map((e,i) => <Cell key={i} fill={e.fill} />)}
                </Pie>
              </PieChart>
              <div className="col" style={{ gap:5, width:'100%', paddingLeft:8 }}>
                {pieData.map((e,i) => (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:6, fontSize:9 }}>
                    <div style={{ width:8, height:8, borderRadius:2, background:e.fill, flexShrink:0 }} />
                    <span style={{ color:'var(--text)', flex:1 }}>{e.name}</span>
                    <span style={{ color:'var(--text2)' }}>{totalVal ? ((e.value/totalVal)*100).toFixed(1) : '—'}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : <EmptyState title="Dağılım yok" text="Gerçek pozisyon verisi yok." />}
        </div>
      </div>

      <div className="panel" style={{ flex:1 }}>
        <div className="ph">
          <span className="ac">■</span> POSITIONS
          <div className="ph-actions"><button className="btn sm" onClick={load} disabled={loading}><RefreshCw size={9} className={loading?'spinner':''} /> REFRESH</button></div>
        </div>
        <div style={{ padding:'6px 14px', borderBottom:'1px solid var(--border)' }}>
          <div className="pos-row" style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.5 }}>
            <span>SYMBOL</span><span>SIZE</span><span>ENTRY</span><span>CURRENT</span><span>VALUE</span><span>P&L</span><span>P&L %</span>
          </div>
        </div>
        <div className="sc" style={{ flex:1 }}>
          {positions.length ? positions.map((p,i) => (
            <div key={i} className="pos-row">
              <span style={{ fontWeight:700, color:'var(--text3)' }}>{p.symbol}</span>
              <span style={{ color:'var(--text)' }}>{p.size}</span>
              <span style={{ color:'var(--text2)' }}>${fmt(p.entry)}</span>
              <span style={{ color:'var(--text3)' }}>${fmt(p.current_price)}</span>
              <span style={{ color:'var(--text3)' }}>${fmt(p.market_value)}</span>
              <span style={{ color:colorOf(p.pnl), fontWeight:600 }}>{Number(p.pnl)>=0?'+':''}${fmt(p.pnl)}</span>
              <span style={{ color:colorOf(p.pnl_pct), fontWeight:600 }}>{Number(p.pnl_pct)>=0?'+':''}${fmt(p.pnl_pct)}%</span>
            </div>
          )) : <EmptyState title="Gerçek pozisyon yok" text="Bağlı hesap pozisyon döndürmedi; mock pozisyon gösterilmiyor." />}
        </div>
      </div>
    </div>
  );
}
