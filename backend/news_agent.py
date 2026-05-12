"""
News Agent — Agent-Reach inspired news aggregation.
Updated to process sentiment more effectively for the LLM agent core.
"""
import asyncio
import httpx
from datetime import datetime
from typing import List, Dict, Any
import xml.etree.ElementTree as ET
import re

# We will extend this to 15+ platforms as planned
RSS_FEEDS = {
    "crypto": [
        "https://cointelegraph.com/rss",
        "https://decrypt.co/feed",
        "https://bitcoinmagazine.com/.rss/full/",
        "https://www.coindesk.com/arc/outboundfeeds/rss/",
    ],
    "finance": [
        "https://feeds.a.dj.com/rss/RSSMarketsMain.xml",
        "https://finance.yahoo.com/news/rssindex",
        "https://www.cnbc.com/id/10000664/device/rss/rss.html",
    ]
}

# Advanced sentiment dictionary or integration point
POSITIVE_WORDS = ['bull', 'surge', 'rally', 'rise', 'gain', 'growth', 'profit', 'strong', 'boost', 'recovery', 'adoption']
NEGATIVE_WORDS = ['bear', 'crash', 'drop', 'fall', 'dump', 'loss', 'sell', 'decline', 'risk', 'fear', 'hack', 'regulation']

def _score_text(text: str) -> float:
    t = text.lower()
    pos = sum(1 for w in POSITIVE_WORDS if w in t)
    neg = sum(1 for w in NEGATIVE_WORDS if w in t)
    total = pos + neg
    # Scale sentiment to -1.0 to 1.0 range
    score = (pos - neg) / (total + 1e-10)
    return max(min(score, 1.0), -1.0)

def _parse_rss(xml_text: str, source: str) -> List[dict]:
    items = []
    try:
        # Improved XML parsing for varied RSS structures
        root = ET.fromstring(xml_text)
        for item in root.findall('.//item')[:10]:
            title = item.findtext('title', '').strip()
            link = item.findtext('link', '').strip()
            desc = item.findtext('description', '').strip()
            # Clean HTML
            desc = re.sub(r'<[^>]+>', '', desc)[:150]
            if title:
                score = _score_text(title + ' ' + desc)
                items.append({
                    "title": title,
                    "summary": desc,
                    "url": link,
                    "source": source,
                    "sentiment_score": round(score, 2)
                })
    except Exception as e:
        print(f"Error parsing RSS from {source}: {e}")
    return items

class NewsAgent:
    """Agent-Reach inspired news aggregator."""
    
    def __init__(self):
        self._cache: Dict[str, dict] = {}
        self._cache_ttl = 300 
    
    async def analyze_news(self, symbol: str) -> dict:
        """Main method used by AgentCore tools."""
        cache_key = f"news_{symbol}"
        if cache_key in self._cache and (datetime.now() - self._cache[cache_key]['ts']).total_seconds() < self._cache_ttl:
            return self._cache[cache_key]['data']
        
        # Aggregate news from sources
        all_articles = []
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            # Aggregate all feeds in parallel
            tasks = []
            for category in RSS_FEEDS.values():
                for url in category:
                    tasks.append(self._fetch_feed(client, url))
            
            results = await asyncio.gather(*tasks)
            for res in results:
                all_articles.extend(res)
        
        # Filter for symbol
        relevant = [n for n in all_articles if symbol.lower() in (n['title'] + n['summary']).lower()]
        
        if not relevant:
            result = {"sentiment": "neutral", "score": 0, "count": 0, "headlines": []}
        else:
            scores = [n['sentiment_score'] for n in relevant]
            avg_score = sum(scores) / len(scores)
            result = {
                "sentiment": "bullish" if avg_score > 0.1 else "bearish" if avg_score < -0.1 else "neutral",
                "score": round(avg_score, 2),
                "count": len(relevant),
                "headlines": [n['title'] for n in relevant[:3]]
            }
        
        self._cache[cache_key] = {'data': result, 'ts': datetime.now()}
        return result

    async def _fetch_feed(self, client, url):
        try:
            resp = await client.get(url, headers={"User-Agent": "QuantumAI/3.0"})
            if resp.status_code == 200:
                source = url.split("//")[1].split("/")[0]
                return _parse_rss(resp.text, source)
        except Exception:
            return []
        return []
