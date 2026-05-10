import React, { useState, useCallback } from 'react';
import { Users, RefreshCw, Zap, Shield, BarChart3, BrainCircuit, Newspaper } from 'lucide-react';
import * as api from '../api';

const AGENT_ICONS = { 'Market Analyst': BarChart3, 'News Aggregator': Newspaper, 'Risk Manager': Shield, 'Kronos Strategy AI': BrainCircuit };
const AGENT_COLORS = { 'Market Analyst': 'var(--cyan)', 'News Aggregator': 'var(--green)', 'Risk Manager': 'var(--orange)', 'Kronos Strategy AI': 'var(--purple)' };

const SYMBOLS = ['BTC/USDT','ETH/USDT','SOL/USDT','BNB/USDT','AAPL','NVDA','TSLA','MSFT'];

function ConfBar({ pct, color }) {
  return (
    <div className="conf-bar">
      <div className="conf-fill" style={{ width:`${pct}%`, background:color||'var(--cyan)' }} />
    </div>
  );
}

function AgentCard({ agent }) {
  const Icon = AGENT_ICONS[agent.agent] || Users;
  const color = AGENT_COLORS[agent.agent] || 'var(--cyan)';
  const sigColor = { bullish:'var(--green)', bearish:'var(--red)', neutral:'var(--orange)', BUY:'var(--green)', SELL:'var(--red)', HOLD:'var(--orange)', 'STRONG BUY':'var(--green)', 'STRONG SELL':'var(--red)', SAFE:'var(--green)', CAUTION:'var(--orange)', MONITOR:'var(--yellow)' };
  const sentiment = agent.sentiment || agent.signal || agent.status || agent.final_signal;
  const sc = sigColor[sentiment] || 'var(--text)';

  return (
    <div className="agent-card">
      <div className="ac-header">
        <div style={{ width:32, height:32, borderRadius:6, background:`rgba(${color==='var(--cyan)'?'0,212,255':color==='var(--green)'?'0,232,122':color==='var(--orange)'?'255,170,0':'124,77,255'},0.12)`, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Icon size={15} color={color} />
        </div>
        <div>
          <div className="ac-name" style={{ color }}>{agent.agent}</div>
          {sentiment && <span style={{ fontSize:8, color:sc, fontWeight:700, letterSpacing:.8 }}>{sentiment?.toUpperCase()}</span>}
        </div>
        {(agent.confidence || agent.risk_level) && (
          <div style={{ marginLeft:'auto', textAlign:'right' }}>
            <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:13, fontWeight:700, color:sc }}>
              {agent.confidence ? `${agent.confidence}%` : agent.risk_level}
            </div>
            <div style={{ fontSize:7.5, color:'var(--text2)' }}>{agent.confidence ? 'CONFIDENCE' : 'RISK'}</div>
          </div>
        )}
      </div>

      {agent.confidence && <ConfBar pct={agent.confidence} color={sc} />}

      <div className="ac-text">
        {agent.analysis || agent.summary || agent.recommendation || agent.reasoning}
      </div>

      {agent.metrics && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
          {Object.entries(agent.metrics).slice(0,4).map(([k,v]) => (
            <div key={k} style={{ background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', borderRadius:3, padding:'3px 8px', fontSize:8.5 }}>
              <span style={{ color:'var(--text2)', letterSpacing:.5 }}>{k.replace(/_/g,' ').toUpperCase()}: </span>
              <span style={{ color:'var(--text3)', fontWeight:600 }}>{typeof v==='number'?v.toFixed(2):v}</span>
            </div>
          ))}
        </div>
      )}

      {agent.findings && (
        <div className="col" style={{ gap:4 }}>
          {agent.findings.slice(0,3).map((f,i) => (
            <div key={i} style={{ display:'flex', gap:8, alignItems:'flex-start', fontSize:9, padding:'4px 8px', background:'rgba(255,255,255,0.02)', borderRadius:3, border:'1px solid var(--border)' }}>
              <span style={{ color:f.sentiment==='positive'?'var(--green)':'var(--red)', flexShrink:0 }}>›</span>
              <span style={{ color:'var(--text)', flex:1, lineHeight:1.4 }}>{f.text.slice(0,100)}</span>
              <span className={`tag ${f.sentiment==='positive'?'bull':'bear'}`} style={{ flexShrink:0 }}>{f.impact}</span>
            </div>
          ))}
        </div>
      )}

      {agent.final_signal && (
        <div style={{ background:`rgba(${agent.final_signal.includes('BUY')?'0,232,122':agent.final_signal.includes('SELL')?'255,45,85':'255,170,0'},0.07)`, border:`1px solid ${sc}33`, borderRadius:4, padding:'8px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <span style={{ fontSize:9, color:'var(--text2)' }}>FINAL DECISION</span>
          <span style={{ fontFamily:'Orbitron,sans-serif', fontSize:14, fontWeight:900, color:sc }}>{agent.final_signal}</span>
        </div>
      )}
    </div>
  );
}

export default function Swarm() {
  const [symbol, setSymbol] = useState('BTC/USDT');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRun, setLastRun] = useState(null);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.runSwarm(symbol);
      setResults(data);
      setLastRun(new Date().toLocaleTimeString());
    } catch(e) { console.error(e); }
    setLoading(false);
  }, [symbol]);

  const strategyAgent = results?.agents?.find(a => a.agent === 'Kronos Strategy AI');
  const sigColor = { 'STRONG BUY':'var(--green)', BUY:'var(--green)', SELL:'var(--red)', 'STRONG SELL':'var(--red)', HOLD:'var(--orange)' }[strategyAgent?.final_signal] || 'var(--text)';

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {/* Header */}
      <div className="panel">
        <div style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ display:'flex', gap:-4 }}>
            {[BarChart3, Newspaper, Shield, BrainCircuit].map((Icon,i) => (
              <div key={i} style={{ width:28, height:28, borderRadius:'50%', background:'var(--panel2)', border:'2px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center', marginLeft:i?-6:0, zIndex:4-i }}>
                <Icon size={12} color={Object.values(AGENT_COLORS)[i]} />
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:11, fontWeight:700, color:'var(--text3)', letterSpacing:2 }}>VIBE-TRADING SWARM</div>
            <div style={{ fontSize:9, color:'var(--text2)', marginTop:2 }}>Multi-agent AI consensus · Market Analyst + News + Risk + Kronos Strategy</div>
          </div>
          <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center' }}>
            {lastRun && <span style={{ fontSize:8.5, color:'var(--text2)' }}>Last run: {lastRun}</span>}
            <select value={symbol} onChange={e=>setSymbol(e.target.value)} style={{ width:130 }}>
              {SYMBOLS.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn" onClick={run} disabled={loading}
              style={{ background:'rgba(124,77,255,0.12)', borderColor:'rgba(124,77,255,0.35)', color:'#a87fff' }}>
              {loading ? <RefreshCw size={11} className="spinner" /> : <Zap size={11} />}
              {loading ? 'ANALYZING...' : '⚡ RUN SWARM'}
            </button>
          </div>
        </div>
      </div>

      {/* Consensus banner */}
      {strategyAgent && (
        <div style={{ background:`rgba(${strategyAgent.final_signal?.includes('BUY')?'0,232,122':strategyAgent.final_signal?.includes('SELL')?'255,45,85':'255,170,0'},0.05)`, border:`1px solid ${sigColor}33`, borderRadius:5, padding:'14px 20px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:8.5, color:'var(--text2)', letterSpacing:1.5, marginBottom:3 }}>SWARM CONSENSUS · {symbol}</div>
            <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:24, fontWeight:900, color:sigColor }}>{strategyAgent.final_signal}</div>
          </div>
          <div style={{ textAlign:'center' }}>
            <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:20, fontWeight:700, color:sigColor }}>{strategyAgent.confidence}%</div>
            <div style={{ fontSize:8.5, color:'var(--text2)' }}>CONFIDENCE</div>
            <ConfBar pct={strategyAgent.confidence} color={sigColor} />
          </div>
          <div style={{ fontSize:9, color:'var(--text2)', maxWidth:300, lineHeight:1.6 }}>{strategyAgent.reasoning}</div>
        </div>
      )}

      {/* Agent cards */}
      {!results ? (
        <div className="panel" style={{ flex:1 }}>
          <div className="loading-cell" style={{ flexDirection:'column', gap:14, flex:1 }}>
            <div style={{ display:'flex', gap:10 }}>
              {[BarChart3,Newspaper,Shield,BrainCircuit].map((Icon,i) => (
                <div key={i} style={{ width:40, height:40, borderRadius:8, background:'rgba(255,255,255,0.03)', border:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <Icon size={18} color="rgba(255,255,255,0.15)" />
                </div>
              ))}
            </div>
            <div style={{ color:'var(--text2)', fontSize:11 }}>Select a symbol and click "RUN SWARM" to activate the agent network</div>
            <div style={{ fontSize:9, color:'var(--text2)', opacity:.7 }}>4 specialized agents will analyze the market and reach a consensus</div>
          </div>
        </div>
      ) : (
        <div className="g2" style={{ gap:10 }}>
          {(results.agents || []).map((agent, i) => (
            <AgentCard key={i} agent={agent} />
          ))}
        </div>
      )}
    </div>
  );
}
