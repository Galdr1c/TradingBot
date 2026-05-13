from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import pandas as pd
import asyncio
import json
from typing import List, Optional, Dict, Any
import os
import numpy as np
from datetime import datetime
from data_manager import DataManager
from predictor import KronosPredictor
from agents import TradingSwarm
from news_agent import NewsAgent
import ta
from agent_core import AgentCore
from backtest_engine import BacktestEngine

# Global instances
data_manager = DataManager()
agent_core = AgentCore()
backtester = BacktestEngine()
predictor = KronosPredictor()
swarm = TradingSwarm()
news_agent = NewsAgent()

app = FastAPI(title="QuantumAI TradingBot API", version="3.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/agent/chat")
async def agent_chat(data: Dict[str, str]):
    message = data.get("message")
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    response = await agent_core.chat(message)
    return {"response": response}

@app.get("/api/config")
async def get_config():
    return {
        "DEFAULT_LLM": os.getenv("DEFAULT_LLM", "ollama"),
        "MODEL_NAME": os.getenv("MODEL_NAME", "deepseek-r1:7b")
    }

@app.post("/api/config")
async def update_config(data: Dict[str, str]):
    os.environ["DEFAULT_LLM"] = data.get("DEFAULT_LLM", "ollama")
    os.environ["MODEL_NAME"] = data.get("MODEL_NAME", "deepseek-r1:7b")
    agent_core.__init__()
    return {"status": "success"}

def to_json(obj):
    if isinstance(obj, np.integer): return int(obj)
    if isinstance(obj, np.floating): return float(obj)
    if isinstance(obj, np.ndarray): return obj.tolist()
    if isinstance(obj, (pd.Timestamp, datetime)): return obj.isoformat()
    try:
        if pd.isna(obj): return None
    except: pass
    return obj

def df_to_records(df):
    return json.loads(df.to_json(orient="records", date_format="iso"))

def compute_indicators(df):
    if len(df) < 20: return df
    try:
        df['rsi'] = ta.momentum.RSIIndicator(df['close'], window=14).rsi()
        macd = ta.trend.MACD(df['close'])
        df['macd'] = macd.macd()
        df['macd_signal'] = macd.macd_signal()
        df['macd_hist'] = macd.macd_diff()
        bb = ta.volatility.BollingerBands(df['close'], window=20, window_dev=2)
        df['bb_upper'] = bb.bollinger_hband()
        df['bb_mid'] = bb.bollinger_mavg()
        df['bb_lower'] = bb.bollinger_lband()
        df['ema_20'] = ta.trend.EMAIndicator(df['close'], window=20).ema_indicator()
        df['ema_50'] = ta.trend.EMAIndicator(df['close'], window=50).ema_indicator()
        df['atr'] = ta.volatility.AverageTrueRange(df['high'], df['low'], df['close']).average_true_range()
        df['obv'] = ta.volume.OnBalanceVolumeIndicator(df['close'], df['volume']).on_balance_volume()
        stoch = ta.momentum.StochasticOscillator(df['high'], df['low'], df['close'])
        df['stoch_k'] = stoch.stoch()
        df['stoch_d'] = stoch.stoch_signal()
    except Exception as e:
        print(f"Indicator error: {e}")
    return df

def get_signal(df):
    if len(df) < 20 or 'rsi' not in df.columns:
        return {"signal": "NEUTRAL", "confidence": 50, "reasons": []}
    last = df.iloc[-1]
    bull, bear, reasons = 0, 0, []
    try:
        rsi = last.get('rsi', 50)
        if rsi < 35: bull += 2; reasons.append(f"RSI oversold ({rsi:.1f})")
        elif rsi > 65: bear += 2; reasons.append(f"RSI overbought ({rsi:.1f})")
        if 'macd' in df.columns:
            if last['macd'] > last['macd_signal']: bull += 1; reasons.append("MACD bullish")
            else: bear += 1; reasons.append("MACD bearish")
        if 'ema_20' in df.columns:
            if last['ema_20'] > last['ema_50']: bull += 1; reasons.append("EMA uptrend")
            else: bear += 1; reasons.append("EMA downtrend")
        total = bull + bear
        if total == 0: return {"signal": "NEUTRAL", "confidence": 50, "reasons": reasons}
        if bull > bear: return {"signal": "BUY", "confidence": int((bull/total)*100), "reasons": reasons}
        if bear > bull: return {"signal": "SELL", "confidence": int((bear/total)*100), "reasons": reasons}
    except: pass
    return {"signal": "NEUTRAL", "confidence": 50, "reasons": reasons}

@app.get("/api/market/tickers")
async def get_tickers(symbols: str = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT"):
    # Clean symbols for CCXT: Ensure / for crypto, none for equity
    sym_list = [s.strip().replace("_", "/") for s in symbols.split(",")]
    results = []
    for s in sym_list:
        try:
            # Try to fetch
            df = await data_manager.get_ohlcv(s, interval='1d', limit=2)
            if not df.empty and len(df) >= 2:
                # ... rest of the logic
                last_close = float(df['close'].iloc[-1])
                prev_close = float(df['close'].iloc[-2])
                change = ((last_close - prev_close) / prev_close) * 100
                results.append({
                    "symbol": s, 
                    "price": to_json(last_close),
                    "change": to_json(change),
                    "volume": to_json(float(df['volume'].iloc[-1])),
                    "high24h": to_json(float(df['high'].iloc[-1])),
                    "low24h": to_json(float(df['low'].iloc[-1])),
                    "category": "crypto" if "/" in s else "equity"
                })
        except Exception as e:
            print(f"Ticker {s}: {e}")
    return results

@app.get("/api/market/history")
async def get_market_history(symbol: str = "BTC/USDT", interval: str = "1h", limit: int = 100):
    try:
        df = await data_manager.get_ohlcv(symbol, interval, limit)
        if df.empty:
            raise HTTPException(status_code=404, detail="Data not found")
        df = compute_indicators(df)
        return {
            "symbol": symbol,
            "interval": interval,
            "data": df_to_records(df),
            "signal": get_signal(df)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/predict/{symbol}")
async def get_prediction(symbol: str = "BTC/USDT", timeframe: str = "1h", pred_len: int = 24):
    try:
        df = await data_manager.get_ohlcv(symbol, interval=timeframe, limit=200)
        if df.empty:
            raise HTTPException(status_code=400, detail="Insufficient data for prediction")
        preds = predictor.predict(df, steps=pred_len)
        return {"symbol": symbol, "predictions": preds}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/backtest/run")
async def run_backtest(symbol: str = "BTC/USDT"):
    df = await data_manager.get_ohlcv(symbol, interval='1h', limit=500)
    if df.empty:
        raise HTTPException(status_code=400, detail="Not enough data for backtest")
    results = backtester.run(df)
    return {"symbol": symbol, "metrics": results}

@app.get("/api/market/signal/{symbol}")
async def get_market_signal(symbol: str, timeframe: str = "1h"):
    try:
        df = await data_manager.get_ohlcv(symbol, interval=timeframe, limit=100)
        if df.empty:
            raise HTTPException(status_code=404, detail="Data not found")
        df = compute_indicators(df)
        return get_signal(df)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/news")
async def get_general_news(symbols: str = "BTC,ETH,crypto", limit: int = 20):
    try:
        all_news = []
        for sym in symbols.split(","):
            res = await news_agent.analyze_news(sym.strip())
            all_news.append({
                "symbol": sym,
                "sentiment": res["sentiment"],
                "score": res["score"],
                "headlines": res["headlines"]
            })
        return all_news
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/portfolio")
async def get_portfolio():
    # Return mock portfolio data for MVP
    return {
        "balance": 24500.50,
        "change_24h": 2.4,
        "assets": [
            {"symbol": "BTC", "amount": 0.45, "value": 18200.0, "change": 1.2},
            {"symbol": "ETH", "amount": 2.5, "value": 4500.0, "change": -0.5},
            {"symbol": "SOL", "amount": 15.0, "value": 1800.5, "change": 5.4}
        ]
    }

@app.get("/api/bots")
async def get_bots():
    return [
        {"id": "kronos_1", "name": "Kronos Scalper", "status": "running", "pair": "BTC/USDT", "profit": 12.5},
        {"id": "swarm_1", "name": "Swarm Alpha", "status": "paused", "pair": "ETH/USDT", "profit": -2.1}
    ]

@app.post("/api/bots/{bot_id}/toggle")
async def toggle_bot(bot_id: str):
    return {"id": bot_id, "status": "toggled"}

@app.get("/api/system/stats")
async def get_system_stats():
    return {
        "cpu": 15.4,
        "memory": 42.1,
        "uptime": "12d 4h 22m",
        "api_status": "healthy"
    }

@app.websocket("/ws/logs")
async def websocket_logs(websocket: WebSocket):
    await websocket.accept()
    try:
        logs = [
            "Initializing QuantumAI Trading Bot...",
            "Connecting to Binance...",
            "Loading Kronos model...",
            "Market data stream active."
        ]
        for log in logs:
            await websocket.send_text(log)
            await asyncio.sleep(1)
        while True:
            await asyncio.sleep(10)
            await websocket.send_text(f"System heartbeat: {datetime.now().strftime('%H:%M:%S')}")
    except WebSocketDisconnect:
        pass

@app.websocket("/ws/market")
async def websocket_market(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await get_tickers()
            await websocket.send_json(data)
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
