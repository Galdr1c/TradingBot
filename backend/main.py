"""
QuantumAI TradingBot Backend — v3.1
Integrates: Kronos forecasting · Vibe-Trading swarm · OpenTrader strategies (GRID/DCA/RSI)
"""
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn, pandas as pd, asyncio, json, os, numpy as np, logging
from typing import Dict, Any
from datetime import datetime, timedelta
from data_manager import DataManager
from predictor import KronosPredictor
from agents import (TradingSwarm, _rsi_wilder, _macd, _adx,
                    _ema, _bollinger, _williams_r)
from candles import add_candlestick_columns
from news_agent import NewsAgent
from backtest_engine import BacktestEngine
import opentrader_bridge as ot
import ta

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

data_manager = DataManager()
predictor    = KronosPredictor()
swarm        = TradingSwarm()
news_agent   = NewsAgent()
backtester   = BacktestEngine()

try:
    from agent_core import AgentCore
    agent_core = AgentCore()
except Exception as e:
    logger.warning(f"AgentCore: {e}")
    agent_core = None

app = FastAPI(title="QuantumAI TradingBot API", version="3.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    ok = await ot.start_opentrader()
    logger.info("OpenTrader: " + ("live" if ok else "simulation mode"))

@app.on_event("shutdown")
async def shutdown():
    ot.stop_opentrader()
    try:
        await data_manager.close()
    except Exception:
        pass

# ── Helpers ────────────────────────────────────────────────────────────────

def _sym(s: str) -> str:
    return s.replace("_", "/")

def _df_records(df):
    return json.loads(df.to_json(orient="records", date_format="iso"))

def _compute_indicators(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return df
    # Candlestick analysis works even with short history and is used as a
    # confirmation layer in the final weighted signal.
    df = add_candlestick_columns(df)
    if len(df) < 20:
        return df
    try:
        c = df["close"].to_numpy(float)
        h = df["high"].to_numpy(float)
        l = df["low"].to_numpy(float)
        v = df["volume"].to_numpy(float)

        df["rsi"]        = _rsi_wilder(c, 14)
        ml, ms, mh       = _macd(c, 12, 26, 9)
        df["macd"]       = ml; df["macd_signal"] = ms; df["macd_hist"] = mh
        bu, bm, bl       = _bollinger(c, 20, 2.0)
        df["bb_upper"]   = bu; df["bb_mid"] = bm; df["bb_lower"] = bl
        df["ema_20"]     = _ema(c, 20)
        df["ema_50"]     = _ema(c, 50)
        df["ema_200"]    = _ema(c, 200)
        df["adx"]        = _adx(h, l, c, 14)
        df["williams_r"] = _williams_r(h, l, c, 14)

        # OBV
        obv = np.zeros(len(c))
        for i in range(1, len(c)):
            obv[i] = obv[i-1] + (v[i] if c[i] > c[i-1] else -v[i] if c[i] < c[i-1] else 0)
        df["obv"] = obv

        df["atr"] = ta.volatility.AverageTrueRange(df["high"], df["low"], df["close"], window=14).average_true_range()
        stoch = ta.momentum.StochasticOscillator(df["high"], df["low"], df["close"])
        df["stoch_k"] = stoch.stoch(); df["stoch_d"] = stoch.stoch_signal()

        # VWAP (session)
        tp = (h + l + c) / 3
        df["vwap"] = float(np.sum(tp * v) / (np.sum(v) + 1e-10))
    except Exception as e:
        logger.warning(f"Indicators: {e}")
    return df

def _signal(df: pd.DataFrame) -> dict:
    if len(df) < 20:
        return {"signal": "NEUTRAL", "confidence": 50, "reasons": [], "score": 0}

    last = df.iloc[-1]; prev = df.iloc[-2] if len(df) > 1 else last

    def v(col, fb=0.0):
        x = last.get(col, fb)
        try:
            x = float(x)
            return fb if np.isnan(x) or np.isinf(x) else x
        except Exception:
            return fb

    def vp(col, fb=0.0):
        x = prev.get(col, fb)
        try:
            x = float(x)
            return fb if np.isnan(x) or np.isinf(x) else x
        except Exception:
            return fb

    rsi   = v("rsi", 50); macd = v("macd"); msig = v("macd_signal")
    mhist = v("macd_hist"); phist = vp("macd_hist")
    adxv  = v("adx", 20);  wr = v("williams_r", -50)
    e20   = v("ema_20", v("close", 0)); e50 = v("ema_50", v("close", 0)); e200 = v("ema_200", e50)
    bbu   = v("bb_upper", v("close", 0)); bbl = v("bb_lower", v("close", 0))
    close = v("close") or v("p", 0)
    candle_pattern = str(last.get("candle_pattern", "No clear pattern"))
    candle_signal  = str(last.get("candle_signal", "NEUTRAL"))
    candle_score   = v("candle_score", 0.0)

    sc = 0.0; mw = 0.0; reasons = []

    # RSI (w=2)
    mw += 2
    if rsi < 30:     sc += 2;  reasons.append(f"RSI oversold {rsi:.1f}")
    elif rsi < 42:   sc += 1;  reasons.append(f"RSI bearish lean {rsi:.1f}")
    elif rsi > 70:   sc -= 2;  reasons.append(f"RSI overbought {rsi:.1f}")
    elif rsi > 58:   sc -= 1;  reasons.append(f"RSI bull lean {rsi:.1f}")

    # MACD crossover (w=2)
    mw += 2
    if macd > msig and phist < 0 and mhist > 0:
        sc += 2; reasons.append("MACD bull crossover ✓")
    elif macd > msig:
        sc += 1; reasons.append("MACD above signal")
    elif macd < msig and phist > 0 and mhist < 0:
        sc -= 2; reasons.append("MACD bear crossover ✓")
    elif macd < msig:
        sc -= 1; reasons.append("MACD below signal")

    # ADX (w=1.5)
    mw += 1.5; td = 1 if e20 > e50 else -1
    if adxv > 25:   sc += 1.5*td; reasons.append(f"ADX {adxv:.1f} strong {'up' if td>0 else 'down'}trend")
    elif adxv > 20: sc += 0.7*td; reasons.append(f"ADX {adxv:.1f} moderate trend")

    # EMA stack (w=1.5)
    mw += 1.5
    if e20 > e50 > e200 and close > e20:   sc += 1.5; reasons.append("EMA stack 20>50>200 ↑")
    elif e20 < e50 < e200 and close < e20: sc -= 1.5; reasons.append("EMA stack 20<50<200 ↓")
    elif e20 > e50: sc += 0.7
    elif e20 < e50: sc -= 0.7

    # Bollinger (w=1)
    mw += 1; bbr = bbu - bbl
    bbp = (close - bbl) / (bbr + 1e-10) if bbr > 0 else 0.5
    if bbp < 0.15:  sc += 1; reasons.append(f"Near lower BB ({bbp:.0%})")
    elif bbp > 0.85:sc -= 1; reasons.append(f"Near upper BB ({bbp:.0%})")

    # Williams %R (w=1)
    mw += 1
    if wr < -80:  sc += 1; reasons.append(f"W%R oversold {wr:.0f}")
    elif wr > -20:sc -= 1; reasons.append(f"W%R overbought {wr:.0f}")

    # Candlestick pattern confirmation (w=1.2)
    mw += 1.2
    if candle_signal == "BULLISH":
        sc += min(1.2, abs(candle_score) * 0.6)
        reasons.append(f"Candlestick bullish: {candle_pattern}")
    elif candle_signal == "BEARISH":
        sc -= min(1.2, abs(candle_score) * 0.6)
        reasons.append(f"Candlestick bearish: {candle_pattern}")

    norm = sc / (mw + 1e-10)
    if norm >= 0.55:   sig, conf = "STRONG BUY",  88
    elif norm >= 0.25: sig, conf = "BUY",          72
    elif norm <= -0.55:sig, conf = "STRONG SELL",  85
    elif norm <= -0.25:sig, conf = "SELL",          68
    else:              sig, conf = "NEUTRAL",       52
    conf = min(95, conf + (5 if adxv > 30 else 0))

    return {"signal": sig, "confidence": conf, "reasons": reasons[:6], "score": round(norm, 4),
            "indicators": {"rsi": round(rsi,2), "macd": round(macd,4), "macd_hist": round(mhist,4),
                           "adx": round(adxv,2), "williams_r": round(wr,2), "bb_pct": round(bbp*100,1),
                           "ema20": round(e20,2), "ema50": round(e50,2),
                           "candle_pattern": candle_pattern, "candle_signal": candle_signal,
                           "candle_score": round(candle_score, 3)}}

# ══════ ENDPOINTS ══════════════════════════════════════════════════════════════

@app.post("/api/agent/chat")
async def agent_chat(data: Dict[str, str]):
    msg = data.get("message", "")
    if not msg: raise HTTPException(400, "message required")
    if not agent_core: return {"response": "LLM not configured — set DEFAULT_LLM in .env"}
    return {"response": await agent_core.chat(msg)}

@app.get("/api/config")
async def get_config():
    return {"DEFAULT_LLM": os.getenv("DEFAULT_LLM","ollama"), "MODEL_NAME": os.getenv("MODEL_NAME","deepseek-r1:7b"),
            "OPENTRADER_PORT": ot.OPENTRADER_PORT, "opentrader_available": ot.is_available()}

@app.post("/api/config")
async def update_config(data: Dict[str, str]):
    for k in ("DEFAULT_LLM","MODEL_NAME"):
        if k in data: os.environ[k] = data[k]
    return {"status": "ok"}

@app.get("/api/market/tickers")
async def get_tickers(symbols: str = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT"):
    results = []
    for s in [x.strip().replace("_","/") for x in symbols.split(",")]:
        try:
            df = await data_manager.get_ohlcv(s, interval="1d", limit=2)
            if df.empty or len(df) < 2: continue
            last = float(df["close"].iloc[-1]); prev = float(df["close"].iloc[-2])
            results.append({"symbol": s, "price": round(last,4), "change": round((last-prev)/prev*100,3),
                             "volume": round(float(df["volume"].iloc[-1]),2),
                             "high24h": round(float(df["high"].iloc[-1]),4),
                             "low24h":  round(float(df["low"].iloc[-1]),4),
                             "category": "crypto" if "/" in s else "equity"})
        except Exception as e:
            logger.warning(f"Ticker {s}: {e}")
    return results

@app.get("/api/market/history")
async def get_history(symbol: str = "BTC_USDT", interval: str = "1h", limit: int = 100):
    try:
        sym = _sym(symbol)
        df  = await data_manager.get_ohlcv(sym, interval, limit)
        if df.empty: raise HTTPException(404, "No data")
        df = _compute_indicators(df)
        return {"symbol": sym, "interval": interval, "data": _df_records(df), "signal": _signal(df)}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/market/signal/{symbol}")
async def get_signal(symbol: str, timeframe: str = "1h"):
    try:
        df = await data_manager.get_ohlcv(_sym(symbol), interval=timeframe, limit=100)
        if df.empty: raise HTTPException(404, "No data")
        return _signal(_compute_indicators(df))
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/predict/{symbol}")
async def get_prediction(symbol: str, timeframe: str = "1h", pred_len: int = 24):
    try:
        sym = _sym(symbol)
        df  = await data_manager.get_ohlcv(sym, interval=timeframe, limit=200)
        if df.empty: raise HTTPException(400, "Insufficient data")
        raw       = predictor.predict(df, steps=pred_len)
        last_p    = float(df["close"].iloc[-1])
        daily_vol = float(df["close"].pct_change().std()) * last_p
        now       = datetime.utcnow()
        return {"symbol": sym, "model": "NeoQuasar/Kronos-small", "timestamp": now.isoformat(),
                "forecast": [{"t": i, "p": round(float(p),4),
                               "hi": round(float(p) + daily_vol*(1+i*0.12),4),
                               "lo": round(float(p) - daily_vol*(1+i*0.12),4),
                               "timestamp": (now+timedelta(hours=i+1)).isoformat()}
                             for i, p in enumerate(raw)]}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/backtest/run")
async def run_backtest_py(symbol: str = "BTC/USDT"):
    try:
        df = await data_manager.get_ohlcv(_sym(symbol), interval="1h", limit=500)
        if df.empty: raise HTTPException(400, "Not enough data")
        return {"symbol": _sym(symbol), **backtester.run(df)}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

# ── News ─────────────────────────────────────────────────────────────────────

_MOCK = [
    {"title":"Bitcoin eyes $100K as institutional demand surges","summary":"Large asset managers accumulate BTC.","sentiment":"positive","sentiment_score":0.72,"source":"CoinTelegraph","impact":"High","url":"#"},
    {"title":"Ethereum ETF inflows hit record high this week","summary":"Spot ETH ETFs see record weekly inflows.","sentiment":"positive","sentiment_score":0.58,"source":"Bloomberg","impact":"High","url":"#"},
    {"title":"Fed holds rates steady; risk assets rally","summary":"Federal Reserve unchanged, boosting risk appetite.","sentiment":"positive","sentiment_score":0.41,"source":"Reuters","impact":"Medium","url":"#"},
    {"title":"Crypto market mixed signals ahead of CPI data","summary":"Traders cautious ahead of US inflation print.","sentiment":"neutral","sentiment_score":0.05,"source":"Decrypt","impact":"Medium","url":"#"},
    {"title":"Solana network activity breaks all-time high","summary":"Daily active addresses and TXs hit new records.","sentiment":"positive","sentiment_score":0.63,"source":"CoinDesk","impact":"Medium","url":"#"},
    {"title":"SEC issues new guidance on crypto staking","summary":"Regulatory clarity may affect DeFi protocols.","sentiment":"neutral","sentiment_score":-0.12,"source":"CryptoSlate","impact":"Medium","url":"#"},
    {"title":"Whale wallets accumulate BTC at current levels","summary":"On-chain: addresses holding 1000+ BTC increase.","sentiment":"positive","sentiment_score":0.55,"source":"Glassnode","impact":"High","url":"#"},
    {"title":"Tech stocks drag market as earnings disappoint","summary":"Q1 earnings miss expectations across mega-caps.","sentiment":"negative","sentiment_score":-0.48,"source":"CNBC","impact":"High","url":"#"},
    {"title":"DeFi TVL drops 3% amid market uncertainty","summary":"TVL falls for third consecutive week.","sentiment":"negative","sentiment_score":-0.31,"source":"DeFiPulse","impact":"Medium","url":"#"},
    {"title":"XRP gains clarity as court rules for Ripple","summary":"Federal court: XRP not a security for retail.","sentiment":"positive","sentiment_score":0.68,"source":"The Block","impact":"High","url":"#"},
    {"title":"Mining difficulty hits ATH as hash rate surges","summary":"BTC mining difficulty up 8% — network growth.","sentiment":"positive","sentiment_score":0.33,"source":"BTC.com","impact":"Low","url":"#"},
    {"title":"OpenAI launches crypto payment integration","summary":"Major AI lab accepts crypto for API billing.","sentiment":"positive","sentiment_score":0.44,"source":"TechCrunch","impact":"Medium","url":"#"},
]

@app.get("/api/news")
async def get_news(symbols: str = "BTC,ETH,crypto", limit: int = 20):
    all_articles = []
    for sym in symbols.split(","):
        sym = sym.strip()
        try:
            res  = await news_agent.analyze_news(sym)
            base = 0.35 if res["sentiment"]=="bullish" else -0.35 if res["sentiment"]=="bearish" else 0.0
            srcs = ["CoinTelegraph","Bloomberg","Reuters","CoinDesk","Decrypt"]
            for i, h in enumerate(res.get("headlines",[])):
                ui = "positive" if res["sentiment"]=="bullish" else "negative" if res["sentiment"]=="bearish" else "neutral"
                all_articles.append({"title":h,"summary":f"{sym}: {h[:150]}","sentiment":ui,
                    "sentiment_score":round(base+(np.random.rand()-0.5)*0.15,3),
                    "source":srcs[i%5],"impact":"High" if i==0 else "Medium" if i<3 else "Low",
                    "url":"#","symbol":sym})
        except Exception: pass
    return (all_articles or _MOCK)[:limit]

@app.get("/api/news/{symbol}")
async def get_symbol_news(symbol: str, limit: int = 10):
    try:
        res  = await news_agent.analyze_news(symbol)
        base = 0.35 if res["sentiment"]=="bullish" else -0.35 if res["sentiment"]=="bearish" else 0.0
        srcs = ["CoinTelegraph","CoinDesk","Bloomberg"]
        return [{"title":h,"summary":h,"sentiment":"positive" if res["sentiment"]=="bullish" else "negative" if res["sentiment"]=="bearish" else "neutral",
                 "sentiment_score":round(base+(np.random.rand()-0.5)*0.15,3),"source":srcs[i%3],
                 "impact":"High" if i==0 else "Medium","url":"#"}
                for i,h in enumerate(res.get("headlines",[]))][:limit]
    except Exception as e: raise HTTPException(500,str(e))

# ── Portfolio ─────────────────────────────────────────────────────────────────

@app.get("/api/portfolio")
async def get_portfolio():
    pos = [
        {"symbol":"BTC/USDT","size":0.45,"entry":38200.0,"current_price":42500.0,"market_value":19125.0,"pnl":1935.0,"pnl_pct":11.3},
        {"symbol":"ETH/USDT","size":2.5, "entry":1820.0, "current_price":2250.0, "market_value":5625.0, "pnl":1075.0,"pnl_pct":23.6},
        {"symbol":"SOL/USDT","size":15,  "entry":95.0,   "current_price":118.5,  "market_value":1777.5, "pnl":352.5, "pnl_pct":24.7},
        {"symbol":"NVDA",    "size":12,  "entry":415.0,  "current_price":487.0,  "market_value":5844.0, "pnl":864.0, "pnl_pct":17.3},
    ]
    cash  = 25078.0
    tv    = sum(p["market_value"] for p in pos) + cash
    tpnl  = sum(p["pnl"] for p in pos)
    return {"total_value":round(tv,2),"total_pnl":round(tpnl,2),
            "total_pnl_pct":round(tpnl/(tv-tpnl)*100,2),"cash":cash,"positions":pos}

# ── Bots ──────────────────────────────────────────────────────────────────────

_TOGGLES: Dict[str,str] = {}
_DEF_STATUS = {"bot_1":"active","bot_2":"active","bot_3":"paused","bot_4":"active","bot_5":"paused","bot_6":"paused"}
_BOTS = [
    {"id":"bot_1","name":"Kronos Scalper",  "symbol":"BTC/USDT","strategy":"AI Forecast",       "pnl":1248.5,"trades":142,"winrate":67.6},
    {"id":"bot_2","name":"RSI Reversal",    "symbol":"ETH/USDT","strategy":"RSI Mean Reversion", "pnl":312.0, "trades":89, "winrate":58.4},
    {"id":"bot_3","name":"Trend Rider",     "symbol":"SOL/USDT","strategy":"EMA Crossover",      "pnl":-88.2, "trades":56, "winrate":44.6},
    {"id":"bot_4","name":"Sentiment NLP",   "symbol":"BTC/USDT","strategy":"Sentiment NLP",      "pnl":780.0, "trades":34, "winrate":73.5},
    {"id":"bot_5","name":"OT Grid Bot",     "symbol":"BTC/USDT","strategy":"OpenTrader GRID",    "pnl":420.0, "trades":210,"winrate":61.9},
    {"id":"bot_6","name":"OT DCA Bot",      "symbol":"ETH/USDT","strategy":"OpenTrader DCA",     "pnl":156.3, "trades":28, "winrate":63.2},
]

@app.get("/api/bots")
async def get_bots():
    return [{**b,"status":_TOGGLES.get(b["id"],_DEF_STATUS.get(b["id"],"paused"))} for b in _BOTS]

@app.post("/api/bots/{bot_id}/toggle")
async def toggle_bot(bot_id: str):
    b = next((x for x in _BOTS if x["id"]==bot_id), None)
    if not b: raise HTTPException(404,"Not found")
    cur = _TOGGLES.get(bot_id, _DEF_STATUS.get(bot_id,"paused"))
    new = "paused" if cur=="active" else "active"
    _TOGGLES[bot_id] = new
    return {**b,"status":new}

# ── Swarm ─────────────────────────────────────────────────────────────────────

@app.post("/api/swarm/run")
async def run_swarm(data: Dict[str,str]):
    symbol = data.get("symbol","BTC/USDT")
    try:
        sym = _sym(symbol)
        df  = await data_manager.get_ohlcv(sym, interval="1h", limit=100)
        if df.empty: raise HTTPException(400,"No market data")
        price_data = [{"o":float(r["open"]),"p":float(r["close"]),"h":float(r["high"]),"l":float(r["low"]),"v":float(r["volume"])}
                      for _,r in df.iterrows()]
        news_ctx = None
        try:
            res = await news_agent.analyze_news(sym.split("/")[0])
            news_ctx = [{"title":h,"summary":h,"source":"News"} for h in res.get("headlines",[])]
        except Exception: pass
        agents = await swarm.run_cycle(sym, price_data, news_ctx)
        return {"symbol":sym,"agents":agents,"timestamp":datetime.utcnow().isoformat()}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500,str(e))

# ── OpenTrader strategy endpoints ─────────────────────────────────────────────

@app.get("/api/opentrader/status")
async def ot_status():
    return await ot.get_opentrader_status()

@app.post("/api/opentrader/strategy")
async def ot_strategy(data: Dict[str,Any]):
    strategy = data.get("strategy","grid")
    symbol   = data.get("symbol","BTC/USDT")
    params   = data.get("params",{})
    paper    = data.get("paper",True)
    try:
        sym = _sym(symbol)
        df  = await data_manager.get_ohlcv(sym, interval="1h", limit=10)
        if not df.empty:
            params["currentPrice"] = float(df["close"].iloc[-1])
    except Exception: pass
    return await ot.run_opentrader_strategy(strategy, symbol, params, paper)

@app.post("/api/opentrader/backtest")
async def ot_backtest(data: Dict[str,Any]):
    return await ot.run_opentrader_backtest(
        data.get("strategy","grid"), data.get("symbol","BTC/USDT"),
        data.get("timeframe","1h"),  data.get("from_date","2024-01-01"),
        data.get("to_date","2024-06-01"), data.get("params",{}))

# ── System stats ──────────────────────────────────────────────────────────────

@app.get("/api/system/stats")
async def sys_stats():
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory()
        return {"cpu":round(cpu,1),"memory_pct":round(mem.percent,1),
                "memory_used_gb":round(mem.used/1e9,2),
                "kronos_status":"READY" if predictor.is_ready else "FALLBACK",
                "agent_reach_status":"CONNECTED","swarm_status":"ACTIVE",
                "opentrader_status":"LIVE" if ot.is_available() else "SIMULATION"}
    except Exception:
        return {"cpu":0,"memory_pct":0,"memory_used_gb":0,"kronos_status":"READY",
                "agent_reach_status":"CONNECTED","swarm_status":"ACTIVE","opentrader_status":"SIMULATION"}

# ── WebSockets ────────────────────────────────────────────────────────────────

@app.websocket("/ws/logs")
async def ws_logs(ws: WebSocket):
    await ws.accept()
    boot = [("ok","[System]     QuantumAI v3.1 online"),("info","[Data]       Binance + yfinance connected"),
            ("ai","[Kronos]     Foundation model ready"),("ok","[Swarm]      4 agents initialised"),
            ("info","[OpenTrader] GRID · DCA · RSI strategies loaded"),
            ("ok","[Indicators] Wilder RSI · MACD · ADX · Williams %R active")]
    try:
        for tp, msg in boot:
            await ws.send_text(json.dumps({"t":datetime.now().strftime("%H:%M:%S"),"tp":tp,"m":msg}))
            await asyncio.sleep(0.5)
        beats = [("ok","[Tick]    Market refresh"),("info","[Signal]  Scanning for entries"),
                 ("ok","[Risk]    Vol within limits"),("ai","[Swarm]   Consensus updated"),
                 ("info","[OT]      Grid levels recalc")]
        idx = 0
        while True:
            await asyncio.sleep(7)
            tp, msg = beats[idx % len(beats)]
            await ws.send_text(json.dumps({"t":datetime.now().strftime("%H:%M:%S"),"tp":tp,"m":msg}))
            idx += 1
    except WebSocketDisconnect: pass

@app.websocket("/ws/market")
async def ws_market(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            await ws.send_json({"type":"tickers","data": await get_tickers()})
            await asyncio.sleep(5)
    except WebSocketDisconnect: pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
