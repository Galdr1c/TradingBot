"""Agent-Reach inspired research adapter.

Provides safe, optional market research without making the UI depend on any
single third-party tool. Every method fails closed with a clear status payload.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List
import asyncio
import re
import httpx

try:
    import feedparser
except Exception:  # pragma: no cover
    feedparser = None


class ResearchAdapter:
    DEFAULT_FEEDS = [
        {"name": "CoinDesk", "url": "https://www.coindesk.com/arc/outboundfeeds/rss/"},
        {"name": "CoinTelegraph", "url": "https://cointelegraph.com/rss"},
        {"name": "Decrypt", "url": "https://decrypt.co/feed"},
        {"name": "Yahoo Finance", "url": "https://finance.yahoo.com/news/rssindex"},
    ]

    def __init__(self, timeout: float = 10.0):
        self.timeout = timeout

    def status(self) -> Dict[str, Any]:
        return {
            "jina_reader": {"available": True, "note": "URL reader fallback via r.jina.ai/http(s)"},
            "rss": {"available": feedparser is not None, "note": "feedparser based RSS reader"},
            "github": {"available": True, "note": "GitHub public REST endpoint, no token required for low-volume checks"},
            "social_channels": {"available": False, "note": "Optional CLI tools such as twitter-cli/rdt-cli are intentionally not auto-run from the app"},
            "updated_at": datetime.utcnow().isoformat(),
        }

    async def read_url(self, url: str, max_chars: int = 4000) -> Dict[str, Any]:
        url = (url or "").strip()
        if not url.startswith(("http://", "https://")):
            return {"ok": False, "error": "URL must start with http:// or https://"}
        safe_url = "https://r.jina.ai/http://" + url[len("http://"):] if url.startswith("http://") else "https://r.jina.ai/" + url
        try:
            async with httpx.AsyncClient(timeout=self.timeout, follow_redirects=True) as client:
                r = await client.get(safe_url)
                r.raise_for_status()
                text = re.sub(r"\n{3,}", "\n\n", r.text).strip()
                return {"ok": True, "url": url, "reader_url": safe_url, "text": text[:max_chars], "chars": min(len(text), max_chars)}
        except Exception as exc:
            return {"ok": False, "url": url, "error": str(exc)}

    async def github_repo(self, repo: str) -> Dict[str, Any]:
        repo = (repo or "").strip().replace("https://github.com/", "").strip("/")
        if not re.match(r"^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", repo):
            return {"ok": False, "error": "Repo format must be owner/name"}
        try:
            async with httpx.AsyncClient(timeout=self.timeout, headers={"Accept": "application/vnd.github+json"}) as client:
                meta = await client.get(f"https://api.github.com/repos/{repo}")
                meta.raise_for_status()
                data = meta.json()
                readme = await client.get(f"https://raw.githubusercontent.com/{repo}/{data.get('default_branch','main')}/README.md")
                text = readme.text[:2500] if readme.status_code < 400 else ""
                return {
                    "ok": True,
                    "repo": repo,
                    "name": data.get("full_name"),
                    "description": data.get("description"),
                    "stars": data.get("stargazers_count"),
                    "forks": data.get("forks_count"),
                    "license": (data.get("license") or {}).get("spdx_id"),
                    "default_branch": data.get("default_branch"),
                    "updated_at": data.get("updated_at"),
                    "topics": data.get("topics", []),
                    "readme_excerpt": text,
                }
        except Exception as exc:
            return {"ok": False, "repo": repo, "error": str(exc)}

    async def rss_briefing(self, query: str = "crypto OR stocks", limit: int = 12) -> Dict[str, Any]:
        query = (query or "").lower().strip()
        limit = max(1, min(int(limit or 12), 30))
        if feedparser is None:
            return {"ok": False, "error": "feedparser is not installed", "items": []}

        def parse_feed(feed):
            parsed = feedparser.parse(feed["url"])
            items = []
            for entry in parsed.entries[:30]:
                title = getattr(entry, "title", "")
                summary = re.sub("<[^>]+>", "", getattr(entry, "summary", ""))
                hay = f"{title} {summary}".lower()
                score = 0
                for term in re.split(r"[,\s|]+", query):
                    if len(term) > 1 and term not in {"or", "and"} and term in hay:
                        score += 1
                if not query or score > 0:
                    items.append({
                        "title": title,
                        "summary": summary[:220],
                        "url": getattr(entry, "link", "#"),
                        "source": feed["name"],
                        "published": getattr(entry, "published", ""),
                        "score": score,
                    })
            return items

        all_items: List[Dict[str, Any]] = []
        tasks = [asyncio.to_thread(parse_feed, feed) for feed in self.DEFAULT_FEEDS]
        for result in await asyncio.gather(*tasks, return_exceptions=True):
            if isinstance(result, list):
                all_items.extend(result)
        all_items.sort(key=lambda x: (x.get("score", 0), x.get("published", "")), reverse=True)
        return {"ok": True, "query": query, "items": all_items[:limit], "sources": [f["name"] for f in self.DEFAULT_FEEDS], "updated_at": datetime.utcnow().isoformat()}
