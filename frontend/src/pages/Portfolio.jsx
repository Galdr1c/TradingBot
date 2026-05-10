import React, { useState, useEffect, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { RefreshCw } from 'lucide-react';
import * as api from '../api';

const fmt = (n,d=2) => n!=null ? Number(n).toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d}) : '—';
const colorOf = n => n>=0?'var(--green)':'var(--red)';

const PIE_COLORS = ['#00d4ff','#00e87a','#7c4dff','#ffaa00','#ff2d55','#ffe066'];

export default function Portfolio() {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(false);
  const [history] = useState(() => {
    const base = 120000;
    return Array.from({length:30}, (_,i) => ({
      d: `D-${30-i}`,
      v: base + (Math.sin(i*0.4)*8000) + (i*500) + (Math.random()*3000-1500)
    }));
  });

  const load = useCallback(async () => {
    setLoading(true);
    try { setPortfolio(await api.getPortfolio()); } catch(e){}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);

  const positions = portfolio?.positions ?? [];
  const totalVal = portfolio?.total_value ?? 128450;
  const totalPnl = portfolio?.total_pnl ?? 1240;
  const cash = portfolio?.cash ?? 25000;

  const pieData = positions.map((p, i) => ({
    name: p.symbol,
    value: p.market_value ?? 0,
    fill: PIE_COLORS[i % PIE_COLORS.length]
  }));
  if (cash > 0) pieData.push({ name: 'CASH', value: cash, fill: '#2a4060' });

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {/* Summary cards */}
      <div className="g4">
        {[
          { label:'TOTAL VALUE', val:`$${fmt(totalVal)}`, color:'var(--cyan)' },
          { label:'TOTAL P&L', val:`${totalPnl>=0?'+':''}$${fmt(totalPnl)}`, color:colorOf(totalPnl) },
          { label:'P&L %', val:`${portfolio?.total_pnl_pct>=0?'+':''}${fmt(portfolio?.total_pnl_pct)}%`, color:colorOf(portfolio?.total_pnl_pct) },
          { label:'CASH', val:`$${fmt(cash)}`, color:'var(--text3)' },
        ].map(m => (
          <div key={m.label} className="mc">
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color:m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Chart + Allocation */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 280px', gap:10, height:240 }}>
        <div className="panel glow-cyan">
          <div className="ph"><span className="ac">■</span> PORTFOLIO VALUE · 30D</div>
          <div className="chart-area">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{top:4,right:4,left:0,bottom:0}}>
                <defs><linearGradient id="gpv" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--green)" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="var(--green)" stopOpacity={0}/>
                </linearGradient></defs>
                <XAxis dataKey="d" tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} interval={6} />
                <YAxis domain={['auto','auto']} tick={{fontSize:8,fill:'var(--text2)'}} tickLine={false} axisLine={false} width={60} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{background:'#040810',border:'1px solid #0f2040',fontSize:10,borderRadius:4}} formatter={v=>[`$${fmt(v)}`,'Value']} />
                <Area type="monotone" dataKey="v" stroke="var(--green)" strokeWidth={1.5} fill="url(#gpv)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel">
          <div className="ph"><span className="ag">■</span> ALLOCATION</div>
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
                  <span style={{ color:'var(--text2)' }}>{((e.value/totalVal)*100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Positions table */}
      <div className="panel" style={{ flex:1 }}>
        <div className="ph">
          <span className="ac">■</span> POSITIONS
          <div className="ph-actions">
            <button className="btn sm" onClick={load} disabled={loading}>
              <RefreshCw size={9} className={loading?'spinner':''} /> REFRESH
            </button>
          </div>
        </div>
        <div style={{ padding:'6px 14px', borderBottom:'1px solid var(--border)' }}>
          <div className="pos-row" style={{ fontSize:7.5, color:'var(--text2)', letterSpacing:1.5 }}>
            <span>SYMBOL</span><span>SIZE</span><span>ENTRY</span><span>CURRENT</span><span>VALUE</span><span>P&L</span><span>P&L %</span>
          </div>
        </div>
        <div className="sc" style={{ flex:1 }}>
          {loading && !positions.length ? (
            <div className="loading-cell"><RefreshCw size={14} className="spinner" /> Loading positions...</div>
          ) : positions.map((p,i) => (
            <div key={i} className="pos-row">
              <span style={{ fontWeight:700, color:'var(--text3)' }}>{p.symbol}</span>
              <span style={{ color:'var(--text)' }}>{p.size}</span>
              <span style={{ color:'var(--text2)' }}>${fmt(p.entry)}</span>
              <span style={{ color:'var(--text3)' }}>${fmt(p.current_price)}</span>
              <span style={{ color:'var(--text3)' }}>${fmt(p.market_value)}</span>
              <span style={{ color:colorOf(p.pnl), fontWeight:600 }}>{p.pnl>=0?'+':''}${fmt(p.pnl)}</span>
              <span style={{ color:colorOf(p.pnl_pct), fontWeight:600 }}>{p.pnl_pct>=0?'+':''}${fmt(p.pnl_pct)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
