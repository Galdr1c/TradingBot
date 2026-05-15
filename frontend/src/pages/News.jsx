import React, { useState, useEffect, useCallback } from 'react';
import { Newspaper, RefreshCw, ExternalLink, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import * as api from '../api';

const TOPICS = ['BTC,ETH,crypto', 'AAPL,NVDA,TSLA,stock market', 'BTC', 'ETH', 'SOL'];

function SentimentIcon({ s }) {
  if (s === 'positive') return <TrendingUp size={11} color="var(--green)" />;
  if (s === 'negative') return <TrendingDown size={11} color="var(--red)" />;
  return <Minus size={11} color="var(--orange)" />;
}

function SentimentTag({ s }) {
  const map = { positive:['bull','var(--green)'], negative:['bear','var(--red)'], neutral:['neutral','var(--orange)'] };
  const [cls, color] = map[s] || ['neutral','var(--orange)'];
  return <span className={`tag ${cls}`} style={{ color }}>{s?.toUpperCase()}</span>;
}

function ScoreBar({ score }) {
  const pct = Math.round(((score + 1) / 2) * 100);
  const color = score > 0.1 ? 'var(--green)' : score < -0.1 ? 'var(--red)' : 'var(--orange)';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <div className="bar-track" style={{ flex:1 }}>
        <div className="bar-fill" style={{ width:`${pct}%`, background:color }} />
      </div>
      <span style={{ fontSize:8, color, minWidth:34 }}>{score>=0?'+':''}{score.toFixed(3)}</span>
    </div>
  );
}

export default function News() {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [topic, setTopic] = useState(TOPICS[0]);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setLoading(true);
    try { setArticles(await api.getNews(topic, 30)); } catch(e){}
    setLoading(false);
  }, [topic]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const id = setInterval(load, 120000); return () => clearInterval(id); }, [load]);

  const filtered = filter === 'all' ? articles : articles.filter(a => a.sentiment === filter);

  const bullCount = articles.filter(a=>a.sentiment==='positive').length;
  const bearCount = articles.filter(a=>a.sentiment==='negative').length;
  const neuCount  = articles.filter(a=>a.sentiment==='neutral').length;
  const avgScore  = articles.length ? articles.reduce((s,a) => s + (a.sentiment_score||0), 0) / articles.length : 0;
  const overallSentiment = avgScore > 0.1 ? 'BULLISH' : avgScore < -0.1 ? 'BEARISH' : 'NEUTRAL';
  const overallColor = avgScore > 0.1 ? 'var(--green)' : avgScore < -0.1 ? 'var(--red)' : 'var(--orange)';

  return (
    <div className="col fade-in" style={{ gap:10 }}>
      {/* Sentiment Summary */}
      <div className="g4">
        {[
          { label:'MARKET SENTIMENT', val:overallSentiment, color:overallColor },
          { label:'BULLISH ARTICLES', val:bullCount, color:'var(--green)' },
          { label:'BEARISH ARTICLES', val:bearCount, color:'var(--red)' },
          { label:'SENTIMENT SCORE', val:`${avgScore>=0?'+':''}${avgScore.toFixed(3)}`, color:overallColor },
        ].map(m => (
          <div key={m.label} className="mc">
            <div className="ml">{m.label}</div>
            <div className="mv" style={{ color:m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="panel">
        <div style={{ padding:'8px 14px', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <Newspaper size={14} color="var(--cyan)" />
          <select value={topic} onChange={e=>setTopic(e.target.value)} style={{ width:200 }}>
            {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <div style={{ display:'flex', gap:4 }}>
            {['all','positive','negative','neutral'].map(f => (
              <button key={f} className="btn sm" onClick={() => setFilter(f)}
                style={{ background: filter===f?'rgba(0,212,255,0.2)':'', borderColor: filter===f?'var(--cyan)':'', textTransform:'capitalize' }}>
                {f === 'positive' ? '🟢' : f === 'negative' ? '🔴' : f === 'neutral' ? '🟡' : '⬜'} {f}
              </button>
            ))}
          </div>
          <button className="btn sm" onClick={load} disabled={loading}>
            <RefreshCw size={9} className={loading?'spinner':''} /> REFRESH
          </button>
          <span style={{ marginLeft:'auto', fontSize:8.5, color:'var(--text2)' }}>{filtered.length} articles · Agent-Reach powered</span>
        </div>
      </div>

      {/* Sentiment gauge */}
      <div className="panel">
        <div className="ph"><span className="ac">■</span> AGGREGATE SENTIMENT GAUGE</div>
        <div style={{ padding:'12px 16px' }}>
          <div style={{ display:'flex', gap:14, alignItems:'center' }}>
            <div style={{ flex:1 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:8.5, color:'var(--text2)', marginBottom:4 }}>
                <span>🔴 BEARISH</span><span>🟢 BULLISH</span>
              </div>
              <div className="bar-track" style={{ height:8, borderRadius:4 }}>
                <div className="bar-fill" style={{
                  width:`${Math.round(((avgScore+1)/2)*100)}%`,
                  background:`linear-gradient(90deg, var(--red), var(--orange) 40%, var(--green))`,
                  borderRadius:4
                }} />
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:'var(--text2)', marginTop:3 }}>
                <span>-1.0</span><span>0</span><span>+1.0</span>
              </div>
            </div>
            <div style={{ textAlign:'center', minWidth:100 }}>
              <div style={{ fontFamily:'Orbitron,sans-serif', fontSize:20, fontWeight:700, color:overallColor }}>{overallSentiment}</div>
              <div style={{ fontSize:9, color:'var(--text2)' }}>Score: {avgScore>=0?'+':''}{avgScore.toFixed(3)}</div>
            </div>
            <div style={{ display:'flex', gap:16, fontSize:9 }}>
              <div style={{ textAlign:'center' }}><div style={{ color:'var(--green)', fontFamily:'Orbitron,sans-serif', fontSize:16 }}>{bullCount}</div><div style={{ color:'var(--text2)' }}>BULL</div></div>
              <div style={{ textAlign:'center' }}><div style={{ color:'var(--orange)', fontFamily:'Orbitron,sans-serif', fontSize:16 }}>{neuCount}</div><div style={{ color:'var(--text2)' }}>NEUT</div></div>
              <div style={{ textAlign:'center' }}><div style={{ color:'var(--red)', fontFamily:'Orbitron,sans-serif', fontSize:16 }}>{bearCount}</div><div style={{ color:'var(--text2)' }}>BEAR</div></div>
            </div>
          </div>
        </div>
      </div>

      {/* Articles */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, flex:1 }}>
        <div className="panel" style={{ flex:1 }}>
          <div className="ph"><span className="ac">■</span> NEWS FEED ({filtered.length})</div>
          <div className="sc" style={{ flex:1, maxHeight:500 }}>
            {loading && !articles.length ? (
              <div className="loading-cell"><RefreshCw size={14} className="spinner" /> Fetching news...</div>
            ) : filtered.map((a,i) => (
              <div key={i} className="news-card" onClick={() => a.url && a.url !== '#' && window.open(a.url,'_blank')}>
                <div style={{ display:'flex', gap:6, alignItems:'flex-start', marginBottom:4 }}>
                  <SentimentIcon s={a.sentiment} />
                  <div className="nc-title">{a.title}</div>
                </div>
                {a.summary && <div style={{ fontSize:9, color:'var(--text2)', lineHeight:1.5, marginBottom:5 }}>{a.summary.slice(0,120)}...</div>}
                <div className="nc-meta">
                  <SentimentTag s={a.sentiment} />
                  <span style={{ background:'rgba(255,255,255,0.04)', padding:'1px 6px', borderRadius:2, border:'1px solid var(--border2)' }}>{a.source}</span>
                  <span style={{ marginLeft:'auto' }}>{a.impact} Impact</span>
                  {a.url && a.url !== '#' && <ExternalLink size={9} color="var(--text2)" />}
                </div>
                <ScoreBar score={a.sentiment_score || 0} />
              </div>
            ))}
          </div>
        </div>

        <div className="panel" style={{ flex:1 }}>
          <div className="ph"><span className="ag">■</span> LIVE SOURCE HIGHLIGHTS</div>
          <div className="sc" style={{ flex:1, maxHeight:500 }}>
            {filtered.slice(0, 8).map((a,i) => (
              <div key={i} className="news-card">
                <div style={{ display:'flex', gap:6, alignItems:'center', marginBottom:5 }}>
                  <SentimentIcon s={a.sentiment} />
                  <div style={{ flex:1, fontFamily:'Inter,sans-serif', fontSize:11, fontWeight:600, color:'var(--text3)', lineHeight:1.4 }}>{a.title}</div>
                  <span className="tag" style={{ background:'rgba(0,212,255,0.1)', color:'var(--cyan)', border:'1px solid rgba(0,212,255,0.2)', flexShrink:0 }}>LIVE</span>
                </div>
                <div className="nc-meta">
                  <SentimentTag s={a.sentiment} />
                  <span style={{ background:'rgba(255,255,255,0.04)', padding:'1px 6px', borderRadius:2, border:'1px solid var(--border2)' }}>{a.source}</span>
                </div>
                <ScoreBar score={a.sentiment_score || 0} />
              </div>
            ))}
            {filtered.length === 0 && (
              <div className="loading-cell">Canlı feed eşleşmesi yok; mock haber gösterilmiyor.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
