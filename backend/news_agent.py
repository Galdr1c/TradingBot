from news_adapter import NewsOrchestrator, SentimentAnalyzer

class NewsAgent:
    def __init__(self):
        self.orchestrator = NewsOrchestrator()
        self.sentiment = SentimentAnalyzer()

    async def analyze_news(self, symbol: str) -> dict:
        # Get data from multiple platforms using Orchestrator
        articles = await self.orchestrator.get_all_news(symbol)
        
        if not articles:
            return {"sentiment": "neutral", "score": 0, "count": 0}
            
        scores = [self.sentiment.analyze(a['title'] + a['summary']) for a in articles]
        avg_score = sum(scores) / len(scores)
        
        return {
            "sentiment": "bullish" if avg_score > 0.2 else "bearish" if avg_score < -0.2 else "neutral",
            "score": round(avg_score, 2),
            "count": len(articles),
            "headlines": [a['title'] for a in articles[:3]]
        }
