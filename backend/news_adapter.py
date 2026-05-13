import asyncio
import httpx
import os
import logging
import feedparser
from datetime import datetime

logger = logging.getLogger("NewsAdapter")

class BaseAdapter:
    def check_health(self):
        raise NotImplementedError
    async def fetch(self, symbol: str):
        raise NotImplementedError

class JinaReaderAdapter(BaseAdapter):
    """Uses Jina Reader API to convert URLs to clean Markdown for LLM ingestion."""
    def __init__(self, urls: list):
        self.urls = urls
        self.base_url = "https://r.jina.ai/"

    def check_health(self):
        return True

    async def fetch(self, symbol: str):
        articles = []
        async with httpx.AsyncClient(timeout=15.0) as client:
            for url in self.urls:
                try:
                    # In a real scenario, we might perform a search first, 
                    # but for now we fetch specific high-value targets.
                    resp = await client.get(f"{self.base_url}{url}")
                    if resp.status_code == 200:
                        content = resp.text
                        if symbol.lower() in content.lower():
                            articles.append({"title": url, "summary": content[:1000], "url": url})
                except Exception as e:
                    logger.error(f"Jina fetch failed for {url}: {e}")
        return articles

class RSSAdapter(BaseAdapter):
    """Fetches news from RSS feeds."""
    def __init__(self, feeds: list):
        self.feeds = feeds

    def check_health(self):
        return True

    async def fetch(self, symbol: str):
        articles = []
        for feed_url in self.feeds:
            try:
                feed = feedparser.parse(feed_url)
                for entry in feed.entries:
                    title = entry.get('title', '')
                    summary = entry.get('summary', entry.get('description', ''))
                    if symbol.lower() in title.lower() or symbol.lower() in summary.lower() or symbol == "crypto":
                        articles.append({
                            "title": title,
                            "summary": summary[:500],
                            "url": entry.get('link', ''),
                            "source": feed_url
                        })
            except Exception as e:
                logger.error(f"RSS fetch failed for {feed_url}: {e}")
        return articles

class NewsOrchestrator:
    def __init__(self):
        self.jina_sources = [
            "https://www.bloomberg.com/crypto",
            "https://www.reuters.com/markets/crypto/",
            "https://cointelegraph.com/",
            "https://decrypt.co/"
        ]
        self.rss_sources = [
            "https://cointelegraph.com/rss",
            "https://www.coindesk.com/arc/outboundfeeds/rss/",
            "https://cryptoslate.com/feed/",
            "https://bitcoinmagazine.com/.rss/full/"
        ]
        self.adapters = {
            "rss": RSSAdapter(self.rss_sources),
            "jina": JinaReaderAdapter(self.jina_sources),
        }

    async def get_all_news(self, symbol: str):
        results = []
        for name, adapter in self.adapters.items():
            if adapter.check_health():
                try:
                    data = await adapter.fetch(symbol)
                    results.extend(data)
                except Exception as e:
                    logger.error(f"{name} failed: {e}")
        return results

class SentimentAnalyzer:
    def __init__(self):
        self.positive = {'bull', 'surge', 'rally', 'rise', 'gain', 'growth', 'profit', 'breakout', 'innovation'}
        self.negative = {'bear', 'crash', 'drop', 'fall', 'dump', 'loss', 'sell', 'decline', 'fear', 'hacked'}

    def analyze(self, text: str) -> float:
        text = text.lower()
        pos = sum(1 for word in self.positive if word in text)
        neg = sum(1 for word in self.negative if word in text)
        total = pos + neg
        if total == 0: return 0.0
        return (pos - neg) / total
