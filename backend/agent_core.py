import os
from dotenv import load_dotenv
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama
from langchain_core.tools import Tool
from langgraph.prebuilt import create_react_agent
import asyncio
import pandas as pd
from data_manager import DataManager
from predictor import KronosPredictor
from news_agent import NewsAgent
import ta
from langchain_core.messages import HumanMessage
from swarm.orchestrator import SwarmOrchestrator

load_dotenv()

class AgentCore:
    def __init__(self):
        self.data_manager = DataManager()
        self.predictor = KronosPredictor()
        self.news_agent = NewsAgent()
        self.llm = self._init_llm()
        self.tools = self._init_tools()
        self.orchestrator = SwarmOrchestrator(self.llm)
        self.agent = self._init_agent("investment_committee")

    def _init_llm(self):
        provider = os.getenv("DEFAULT_LLM", "ollama").lower()
        model = os.getenv("MODEL_NAME", "deepseek-r1:7b")
        
        if provider == "openai":
            return ChatOpenAI(model=model, api_key=os.getenv("OPENAI_API_KEY"))
        elif provider == "ollama":
            return ChatOllama(model=model, base_url=os.getenv("OLLAMA_BASE_URL", "http://localhost:11434"))
        return ChatOllama(model=model)

    def _init_tools(self):
        return [
            Tool(
                name="GetMarketData",
                func=lambda q: asyncio.run(self.data_manager.get_ohlcv(q)).to_string(),
                description="Fetches OHLCV data for a symbol. Input: 'BTC/USDT'."
            ),
            Tool(
                name="PredictPrice",
                func=lambda q: str(self.predictor.predict(asyncio.run(self.data_manager.get_ohlcv(q)))),
                description="Predicts future price for a symbol. Input: 'BTC/USDT'."
            ),
            Tool(
                name="AnalyzeNews",
                func=lambda q: str(asyncio.run(self.news_agent.analyze_news(q))),
                description="Analyzes news sentiment for a symbol. Input: 'BTC'."
            ),
            Tool(
                name="TechnicalAnalysis",
                func=self._run_ta,
                description="Calculates RSI/MACD for a symbol. Input: 'BTC/USDT'."
            )
        ]

    def _run_ta(self, symbol: str):
        df = asyncio.run(self.data_manager.get_ohlcv(symbol))
        if df.empty: return "No data."
        rsi = ta.momentum.RSIIndicator(df['close']).rsi().iloc[-1]
        return f"RSI: {rsi:.2f}"

    def _init_agent(self, preset):
        return self.orchestrator.create_swarm(preset, self.tools)

    async def chat(self, message: str):
        try:
            inputs = {"messages": [HumanMessage(content=message)]}
            result = await self.agent.ainvoke(inputs)
            return result["messages"][-1].content
        except Exception as e:
            return f"Error: {str(e)}"
