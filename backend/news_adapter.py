import asyncio
import httpx
from bs4 import BeautifulSoup
import feedparser
from datetime import datetime
import logging

logger = logging.getLogger("NewsAdapter")

class NewsAdapter:
    def __init__(self):
        self.sources = {
            "crypto_news": "https://cointelegraph.com/rss",
            "coindesk": "https://www.coindesk.com/arc/outboundfeeds/rss/",
        }

    async def fetch_rss(self, url):
        async with httpx.AsyncClient() as client:
            response = await client.get(url)
            feed = feedparser.parse(response.text)
            return [{"title": entry.title, "summary": entry.summary, "link": entry.link} for entry in feed.entries[:5]]

    async def get_all_news(self):
        tasks = [self.fetch_rss(url) for url in self.sources.values()]
        results = await asyncio.gather(*tasks)
        combined = []
        for res in results:
            combined.extend(res)
        return combined

class SentimentAnalyzer:
    def __init__(self):
        # Basic sentiment list for MVP, will be replaced by FinBERT
        self.positive = {'bull', 'surge', 'rally', 'rise', 'gain', 'growth', 'profit', 'breakout'}
        self.negative = {'bear', 'crash', 'drop', 'fall', 'dump', 'loss', 'sell', 'decline', 'fear'}

    def analyze(self, text: str) -> float:
        text = text.lower()
        pos = sum(1 for word in self.positive if word in text)
        neg = sum(1 for word in self.negative if word in text)
        total = pos + neg
        if total == 0: return 0.0
        return (pos - neg) / total
