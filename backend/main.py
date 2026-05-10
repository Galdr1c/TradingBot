from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import pandas as pd
import ccxt
import yfinance as yf
import torch
import asyncio
import json
from typing import List, Optional
import os
import numpy as np
from datetime import datetime
from predictor import KronosPredictor
from agents import TradingSwarm

app = FastAPI(title="QuantumAI Real-Time Backend")

# Helper to convert numpy types for JSON serialization
def convert_types(obj):
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global instances
predictor = KronosPredictor()
swarm = TradingSwarm()
binance = ccxt.binance()

@app.get("/api/market/tickers")
async def get_tickers(symbols: str = "BTC/USDT,ETH/USDT,SOL/USDT,AAPL,NVDA"):
    sym_list = symbols.split(",")
    results = []
    for s in sym_list:
        try:
            if "/" in s:
                t = binance.fetch_ticker(s)
                results.append({
                    "symbol": s,
                    "price": convert_types(t['last']),
                    "change": convert_types(t['percentage']),
                    "volume": convert_types(t['quoteVolume']),
                    "category": "crypto"
                })
            else:
                try:
                    stock = yf.Ticker(s)
                    hist = stock.history(period="2d")
                    if not hist.empty and len(hist) >= 2:
                        last = hist['Close'].iloc[-1]
                        prev = hist['Close'].iloc[-2]
                        results.append({
                            "symbol": s,
                            "price": convert_types(last),
                            "change": convert_types(((last - prev) / prev) * 100),
                            "volume": convert_types(hist['Volume'].iloc[-1]),
                            "category": "equity"
                        })
                    elif not hist.empty:
                        last = hist['Close'].iloc[-1]
                        results.append({
                            "symbol": s,
                            "price": convert_types(last),
                            "change": 0.0,
                            "volume": convert_types(hist['Volume'].iloc[-1]),
                            "category": "equity"
                        })
                except Exception as e:
                    print(f"Error fetching stock {s}: {e}")
                    continue
        except:
            continue
    return results

@app.get("/api/market/history/{symbol}")
async def get_history(symbol: str, timeframe: str = "1h", limit: int = 100):
    try:
        if "/" in symbol:
            ohlcv = binance.fetch_ohlcv(symbol, timeframe=timeframe, limit=limit)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            return [ {k: convert_types(v) for k, v in d.items()} for d in df.to_dict(orient="records") ]
        else:
            stock = yf.Ticker(symbol)
            df = stock.history(period="5d", interval="1h")
            df = df.reset_index()
            df.columns = [c.lower() for c in df.columns]
            return [ {k: convert_types(v) for k, v in d.items()} for d in df.to_dict(orient="records") ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/predict/{symbol}")
async def predict(symbol: str):
    try:
        # Fetch actual history for prediction
        if "/" in symbol:
            ohlcv = binance.fetch_ohlcv(symbol, timeframe="1h", limit=100)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        else:
            stock = yf.Ticker(symbol)
            df = stock.history(period="5d", interval="1h")
            df = df.reset_index()
            df.columns = [c.lower() for c in df.columns]
        
        forecast = predictor.predict(df)
        return {
            "symbol": symbol,
            "forecast": [ {k: convert_types(v) for k, v in f.items()} for f in forecast ],
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/swarm/run/{symbol}")
async def run_swarm(symbol: str):
    try:
        # Get some history for analysis
        hist = await get_history(symbol, limit=50)
        # Reformat history for analyst
        price_data = [{"p": d['close']} for d in hist]
        
        results = await swarm.run_cycle(symbol, price_data)
        return {
            "symbol": symbol,
            "agents": results,
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/market")
async def websocket_market(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            # Broadcast updates every 2 seconds
            tickers = await get_tickers()
            await websocket.send_json(tickers)
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        print("Market WS Disconnected")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
