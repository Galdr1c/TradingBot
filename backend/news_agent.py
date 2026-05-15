from news_adapter import NewsOrchestrator, SentimentAnalyzer


class NewsAgent:
    def __init__(self):
        self.orchestrator = NewsOrchestrator()
        self.sentiment = SentimentAnalyzer()

    async def analyze_news(self, symbol: str) -> dict:
        """Analyze only real articles returned by live RSS/Jina adapters."""
        articles = await self.orchestrator.get_all_news(symbol)
        if not articles:
            return {"sentiment": "neutral", "score": 0, "count": 0, "headlines": [], "articles": []}

        enriched = []
        scores = []
        for article in articles:
            text = f"{article.get('title', '')} {article.get('summary', '')}"
            score = self.sentiment.analyze(text)
            scores.append(score)
            enriched.append({
                "title": article.get("title", ""),
                "summary": article.get("summary", ""),
                "url": article.get("url", ""),
                "source": article.get("source", "live-feed"),
                "sentiment_score": round(float(score), 3),
            })

        avg_score = sum(scores) / len(scores)
        return {
            "sentiment": "bullish" if avg_score > 0.2 else "bearish" if avg_score < -0.2 else "neutral",
            "score": round(avg_score, 3),
            "count": len(enriched),
            "headlines": [a["title"] for a in enriched[:5]],
            "articles": enriched,
        }
