import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Search, GitBranch, Radio, ExternalLink, Globe2, ShieldAlert } from 'lucide-react';
import * as api from '../api';
import { EmptyState, ErrorState, LoadingState, useToast } from '../components/AppShellUtils';

const REPOS = ['HKUDS/Vibe-Trading', 'Panniantong/Agent-Reach', 'shiyu-coder/Kronos', 'Open-Trader/opentrader'];

function SourceCard({ name, item }) {
  const ok = Boolean(item?.available);
  return <div className="lab-card"><div className="lab-card-top"><span className={ok ? 'dot-ok' : 'dot-warn'} /> <strong>{name}</strong></div><p>{item?.note || 'Durum bilinmiyor'}</p></div>;
}

function Article({ item }) {
  return <div className="research-item">
    <div><strong>{item.title || 'Untitled'}</strong><p>{item.summary || 'Özet yok'}</p></div>
    <div className="research-meta"><span>{item.source || 'source'}</span>{item.url && item.url !== '#' && <a href={item.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /></a>}</div>
  </div>;
}

export default function Research() {
  const { notify } = useToast();
  const [query, setQuery] = useState('BTC ETH market risk');
  const [url, setUrl] = useState('');
  const [repo, setRepo] = useState('HKUDS/Vibe-Trading');
  const [status, setStatus] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [repoInfo, setRepoInfo] = useState(null);
  const [reader, setReader] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [s, b] = await Promise.all([api.getResearchStatus(), api.getResearchBriefing(query, 12)]);
      setStatus(s); setBriefing(b);
      if (b?.ok === false) notify(b.error || 'Research briefing alınamadı', 'error');
    } catch (e) { setError(e); notify(e.message, 'error'); }
    finally { setLoading(false); }
  }, [query, notify]);

  const inspectRepo = async (target = repo) => {
    setRepo(target);
    setRepoInfo(null);
    try {
      const res = await api.inspectGithubRepo(target);
      setRepoInfo(res);
      if (res?.ok === false) notify(res.error || 'Repo okunamadı', 'error');
    } catch (e) { notify(e.message, 'error'); }
  };

  const readUrl = async () => {
    if (!url.trim()) return notify('URL girmen gerekiyor', 'error');
    setReader(null);
    try {
      const res = await api.readResearchUrl(url.trim());
      setReader(res);
      if (res?.ok === false) notify(res.error || 'URL okunamadı', 'error');
    } catch (e) { notify(e.message, 'error'); }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="col fade-in" style={{ gap: 14 }}>
    <div className="panel">
      <div className="ph"><span className="ac">■</span> RESEARCH AUTOPILOT</div>
      <div className="panel-pad research-toolbar">
        <div className="wide-input"><Search size={15} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="BTC, ETH, NVDA, macro, funding, liquidity..." /></div>
        <button className="btn" type="button" onClick={load} disabled={loading}><RefreshCw size={13} className={loading ? 'spinner' : ''} /> Briefing yenile</button>
      </div>
    </div>

    {status && <div className="lab-grid four">
      {Object.entries(status).filter(([_, v]) => typeof v === 'object').map(([k, v]) => <SourceCard key={k} name={k.replace(/_/g, ' ').toUpperCase()} item={v} />)}
    </div>}

    <div className="g2 lab-split">
      <div className="panel">
        <div className="ph"><span className="ag">■</span> MARKET BRIEFING</div>
        <div className="panel-pad col" style={{ gap: 10 }}>
          {loading ? <LoadingState text="Kaynaklar taranıyor..." /> : error ? <ErrorState error={error} onRetry={load} /> : briefing?.items?.length ? briefing.items.map((x, i) => <Article key={`${x.url}-${i}`} item={x} />) : <EmptyState title="Sonuç yok" text="Başka bir sorgu deneyebilirsin." />}
        </div>
      </div>

      <div className="panel">
        <div className="ph"><span className="ap">■</span> REPO INTELLIGENCE</div>
        <div className="panel-pad col" style={{ gap: 12 }}>
          <div className="repo-buttons">{REPOS.map(r => <button className="btn sm" type="button" key={r} onClick={() => inspectRepo(r)}><GitBranch size={12} /> {r.split('/')[1]}</button>)}</div>
          <div className="wide-input"><GitBranch size={15} /><input value={repo} onChange={e => setRepo(e.target.value)} placeholder="owner/repo" /></div>
          <button className="btn" type="button" onClick={() => inspectRepo(repo)}><Radio size={13} /> Repo incele</button>
          {repoInfo && <div className="repo-card">
            {repoInfo.ok ? <>
              <div className="repo-title">{repoInfo.name}</div>
              <p>{repoInfo.description}</p>
              <div className="repo-stats"><span>★ {repoInfo.stars ?? '—'}</span><span>⑂ {repoInfo.forks ?? '—'}</span><span>{repoInfo.license || 'NO LICENSE'}</span><span>{repoInfo.default_branch}</span></div>
              <pre>{(repoInfo.readme_excerpt || '').slice(0, 1200)}</pre>
            </> : <div className="warn-box"><ShieldAlert size={16} /> {repoInfo.error}</div>}
          </div>}
        </div>
      </div>
    </div>

    <div className="panel">
      <div className="ph"><span className="aa">■</span> SAFE URL READER</div>
      <div className="panel-pad col" style={{ gap: 10 }}>
        <div className="research-toolbar"><div className="wide-input"><Globe2 size={15} /><input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." /></div><button type="button" className="btn" onClick={readUrl}>URL oku</button></div>
        {reader && <div className="reader-box">{reader.ok ? <pre>{reader.text}</pre> : <div className="warn-box"><ShieldAlert size={16} /> {reader.error}</div>}</div>}
      </div>
    </div>
  </div>;
}
