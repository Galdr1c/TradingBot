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

class NewsOrchestrator:
    def __init__(self):
        self.sources = [
            "https://www.bloomberg.com/crypto",
            "https://www.reuters.com/markets/crypto/",
            "https://cointelegraph.com/",
            "https://decrypt.co/"
        ]
        self.adapters = {
            "jina": JinaReaderAdapter(self.sources),
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
