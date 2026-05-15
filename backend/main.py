"""
QuantumAI TradingBot Backend — v3.4 Live Data Only
Integrates: Kronos forecasting · Vibe-Trading swarm · OpenTrader strategies (GRID/DCA/RSI)
"""
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn, pandas as pd, asyncio, json, os, numpy as np, logging
from typing import Dict, Any
from datetime import datetime, timedelta
from data_manager import DataManager, LiveDataUnavailable
from predictor import KronosPredictor
from agents import (TradingSwarm, _rsi_wilder, _macd, _adx,
                    _ema, _bollinger, _williams_r)
from candles import add_candlestick_columns
from news_agent import NewsAgent
from backtest_engine import BacktestEngine
from research_adapter import ResearchAdapter
from correlation_engine import CorrelationEngine
from risk_engine import RiskEngine
import opentrader_bridge as ot
import ta

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

data_manager = DataManager()
predictor    = KronosPredictor()
swarm        = TradingSwarm()
news_agent   = NewsAgent()
backtester   = BacktestEngine()
research     = ResearchAdapter()
correlator   = CorrelationEngine()
risk_engine  = RiskEngine()

try:
    from agent_core import AgentCore
    agent_core = AgentCore()
except Exception as e:
    logger.warning(f"AgentCore: {e}")
    agent_core = None

app = FastAPI(title="QuantumAI TradingBot API", version="3.4.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

@app.on_event("startup")
async def startup():
    ok = await ot.start_opentrader()
    logger.info("OpenTrader: " + ("live" if ok else "not available — execution disabled"))

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

def _clean_value(x):
    try:
        if x is None:
            return None
        if isinstance(x, (float, np.floating)) and (np.isnan(x) or np.isinf(x)):
            return None
        if isinstance(x, (int, float, str, bool)):
            return x
        if hasattr(x, "isoformat"):
            return x.isoformat()
    except Exception:
        pass
    return x

def _sanitize(obj):
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(v) for v in obj]
    if isinstance(obj, tuple):
        return [_sanitize(v) for v in obj]
    return _clean_value(obj)

def _df_records(df):
    if df is None or df.empty:
        return []
    records = json.loads(df.replace({np.nan: None}).to_json(orient="records", date_format="iso"))
    return _sanitize(records)

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

        # Expanding VWAP; uses only candles up to each timestamp to avoid lookahead leakage.
        tp = (h + l + c) / 3
        cum_vol = np.cumsum(np.maximum(v, 0)) + 1e-10
        df["vwap"] = np.cumsum(tp * np.maximum(v, 0)) / cum_vol
    except Exception as e:
        logger.warning(f"Indicators: {e}")
    return df

def _signal(df: pd.DataFrame) -> dict:
    """Weighted technical signal with risk and data-quality metadata.

    The engine intentionally avoids hard guarantees. It combines trend,
    momentum, volatility, volume and candlestick confirmation, then returns
    a bounded confidence plus ATR-based levels for risk planning.
    """
    if df is None or df.empty or len(df) < 20:
        return {"signal": "NEUTRAL", "confidence": 45, "reasons": ["Insufficient candles"], "score": 0, "quality": {"candles": 0}}

    df = df.copy().sort_values("timestamp") if "timestamp" in df.columns else df.copy()
    last = df.iloc[-1]
    prev = df.iloc[-2] if len(df) > 1 else last

    def num(row, col, fb=0.0):
        try:
            x = row.get(col, fb)
            x = float(x)
            return fb if np.isnan(x) or np.isinf(x) else x
        except Exception:
            return fb

    close = num(last, "close", num(last, "p", 0.0))
    prev_close = num(prev, "close", close)
    rsi = num(last, "rsi", 50.0)
    macd = num(last, "macd", 0.0)
    msig = num(last, "macd_signal", 0.0)
    mhist = num(last, "macd_hist", 0.0)
    phist = num(prev, "macd_hist", 0.0)
    adxv = num(last, "adx", 20.0)
    wr = num(last, "williams_r", -50.0)
    e20 = num(last, "ema_20", close)
    e50 = num(last, "ema_50", close)
    e200 = num(last, "ema_200", e50)
    bbu = num(last, "bb_upper", close * 1.02)
    bbl = num(last, "bb_lower", close * 0.98)
    atr = num(last, "atr", max(abs(close - prev_close), close * 0.01))
    volume = num(last, "volume", 0.0)
    vwap = num(last, "vwap", close)
    candle_pattern = str(last.get("candle_pattern", "No clear pattern"))
    candle_signal = str(last.get("candle_signal", "NEUTRAL"))
    candle_score = num(last, "candle_score", 0.0)

    closes = pd.to_numeric(df["close"], errors="coerce").dropna().tail(40).to_numpy(float) if "close" in df else np.array([])
    trend_pct = 0.0
    if len(closes) >= 8 and close:
        x = np.arange(len(closes[-20:]))
        y = closes[-20:]
        trend_pct = float(np.polyfit(x, y, 1)[0] / close * 100)

    vol_ratio = 1.0
    if "volume" in df and len(df) >= 20:
        vols = pd.to_numeric(df["volume"], errors="coerce").fillna(0).tail(20).to_numpy(float)
        vol_ratio = float(vols[-1] / (np.mean(vols[:-1]) + 1e-10)) if len(vols) > 1 else 1.0
        if not np.isfinite(vol_ratio):
            vol_ratio = 1.0

    score = 0.0
    max_score = 0.0
    reasons = []

    def add(weight, value, reason=None):
        nonlocal score, max_score, reasons
        max_score += abs(weight)
        score += float(value)
        if reason:
            reasons.append(reason)

    # Momentum: RSI is mean-reversion weighted, not used as a standalone promise.
    if rsi < 28:
        add(2.0, 2.0, f"RSI oversold {rsi:.1f}")
    elif rsi < 40:
        add(2.0, 0.9, f"RSI recovering zone {rsi:.1f}")
    elif rsi > 72:
        add(2.0, -2.0, f"RSI overbought {rsi:.1f}")
    elif rsi > 60:
        add(2.0, -0.8, f"RSI elevated {rsi:.1f}")
    else:
        add(2.0, 0.0)

    # MACD with histogram flip confirmation.
    if macd > msig and phist <= 0 < mhist:
        add(2.0, 2.0, "MACD bullish crossover")
    elif macd > msig:
        add(2.0, 0.9, "MACD above signal")
    elif macd < msig and phist >= 0 > mhist:
        add(2.0, -2.0, "MACD bearish crossover")
    elif macd < msig:
        add(2.0, -0.9, "MACD below signal")
    else:
        add(2.0, 0.0)

    # Trend regime: ADX strengthens the EMA/trend direction rather than blindly buying strength.
    trend_dir = 1 if (e20 > e50 and trend_pct >= 0) else -1 if (e20 < e50 and trend_pct <= 0) else 0
    if adxv >= 28 and trend_dir:
        add(1.6, 1.6 * trend_dir, f"ADX {adxv:.1f} confirms {'up' if trend_dir > 0 else 'down'}trend")
    elif adxv >= 20 and trend_dir:
        add(1.6, 0.7 * trend_dir, f"ADX {adxv:.1f} moderate trend")
    else:
        add(1.6, 0.0, "Range-bound / weak trend")

    # EMA stack and price location.
    if e20 > e50 > e200 and close >= e20:
        add(1.5, 1.5, "Bullish EMA stack 20>50>200")
    elif e20 < e50 < e200 and close <= e20:
        add(1.5, -1.5, "Bearish EMA stack 20<50<200")
    elif e20 > e50:
        add(1.5, 0.6, "EMA20 above EMA50")
    elif e20 < e50:
        add(1.5, -0.6, "EMA20 below EMA50")
    else:
        add(1.5, 0.0)

    # Bollinger and Williams %R mean-reversion context.
    bb_width = bbu - bbl
    bbp = (close - bbl) / (bb_width + 1e-10) if bb_width > 0 else 0.5
    if bbp < 0.12:
        add(1.0, 1.0, f"Near lower Bollinger band ({bbp:.0%})")
    elif bbp > 0.88:
        add(1.0, -1.0, f"Near upper Bollinger band ({bbp:.0%})")
    else:
        add(1.0, 0.0)

    if wr < -85:
        add(0.9, 0.9, f"Williams %R oversold {wr:.0f}")
    elif wr > -15:
        add(0.9, -0.9, f"Williams %R overbought {wr:.0f}")
    else:
        add(0.9, 0.0)

    # Volume and VWAP confirmation.
    if vol_ratio >= 1.35 and trend_dir > 0 and close > vwap:
        add(1.0, 1.0, f"Volume {vol_ratio:.1f}x confirms upside")
    elif vol_ratio >= 1.35 and trend_dir < 0 and close < vwap:
        add(1.0, -1.0, f"Volume {vol_ratio:.1f}x confirms downside")
    else:
        add(1.0, 0.0)

    if close > vwap * 1.001:
        add(0.5, 0.5, "Price above VWAP")
    elif close < vwap * 0.999:
        add(0.5, -0.5, "Price below VWAP")
    else:
        add(0.5, 0.0)

    # Candlestick pattern as confirmation layer only.
    if candle_signal == "BULLISH":
        add(1.2, min(1.2, abs(candle_score) * 0.55), f"Bullish candle: {candle_pattern}")
    elif candle_signal == "BEARISH":
        add(1.2, -min(1.2, abs(candle_score) * 0.55), f"Bearish candle: {candle_pattern}")
    else:
        add(1.2, 0.0)

    norm = float(score / (max_score + 1e-10))
    if norm >= 0.58:
        sig, conf = "STRONG BUY", 86
    elif norm >= 0.28:
        sig, conf = "BUY", 70
    elif norm <= -0.58:
        sig, conf = "STRONG SELL", 84
    elif norm <= -0.28:
        sig, conf = "SELL", 68
    else:
        sig, conf = "NEUTRAL", 52

    atr_pct = (atr / close * 100) if close else 0.0
    if atr_pct > 5:
        conf -= 8
        reasons.append(f"High volatility: ATR {atr_pct:.2f}%")
    if len(df) < 80:
        conf -= 5
        reasons.append("Limited candle history")
    if adxv > 30 and abs(norm) > 0.28:
        conf += 4
    conf = int(min(94, max(35, conf)))

    if sig in {"BUY", "STRONG BUY"}:
        stop = close - atr * 1.8
        take = close + atr * 2.6
    elif sig in {"SELL", "STRONG SELL"}:
        stop = close + atr * 1.8
        take = close - atr * 2.6
    else:
        stop = close - atr * 1.5
        take = close + atr * 1.5

    ts = last.get("timestamp") if "timestamp" in df.columns else None
    source = str(last.get("source", "unknown"))
    quality = {
        "candles": int(len(df)),
        "source": source,
        "interval": str(last.get("interval", "unknown")),
        "latest_timestamp": _clean_value(ts),
        "is_live_data": source in {"binance", "yfinance"},
        "atr_pct": round(float(atr_pct), 3),
    }

    payload = {
        "signal": sig,
        "confidence": conf,
        "reasons": reasons[:7],
        "score": round(norm, 4),
        "risk": {
            "last_price": round(close, 6),
            "stop_loss": round(float(stop), 6),
            "take_profit": round(float(take), 6),
            "atr": round(float(atr), 6),
            "atr_pct": round(float(atr_pct), 3),
            "risk_note": "ATR-based educational planning; not financial advice",
        },
        "quality": quality,
        "indicators": {
            "rsi": round(rsi, 2), "macd": round(macd, 4), "macd_signal": round(msig, 4), "macd_hist": round(mhist, 4),
            "adx": round(adxv, 2), "williams_r": round(wr, 2), "bb_pct": round(bbp * 100, 1),
            "ema20": round(e20, 4), "ema50": round(e50, 4), "ema200": round(e200, 4),
            "vwap": round(vwap, 4), "volume_ratio": round(vol_ratio, 3), "trend_slope_pct": round(trend_pct, 4),
            "candle_pattern": candle_pattern, "candle_signal": candle_signal, "candle_score": round(candle_score, 3),
        }
    }
    return _sanitize(payload)

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
            "OPENTRADER_PORT": ot.OPENTRADER_PORT, "opentrader_available": ot.is_available(), "LIVE_DATA_ONLY": True, "ALLOW_REAL_CACHE_FALLBACK": data_manager.allow_cache_recovery}

@app.post("/api/config")
async def update_config(data: Dict[str, str]):
    for k in ("DEFAULT_LLM","MODEL_NAME"):
        if k in data: os.environ[k] = data[k]
    return {"status": "ok"}

@app.get("/api/market/tickers")
async def get_tickers(symbols: str = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT"):
    results = []
    errors = []
    for raw in [x.strip() for x in symbols.split(",") if x.strip()]:
        s = _sym(raw)
        try:
            results.append(_sanitize(await data_manager.get_quote(s)))
        except Exception as e:
            logger.warning("Ticker %s unavailable: %s", s, e)
            errors.append({"symbol": s, "error": str(e)})
    # Empty list is intentional: no mock ticker values are emitted.
    return {"data": results, "errors": errors, "live_data_only": True, "timestamp": datetime.utcnow().isoformat()}

@app.get("/api/market/history")
async def get_history(symbol: str = "BTC_USDT", interval: str = "1h", limit: int = 100):
    sym = _sym(symbol)
    interval = str(interval or "1h")
    limit = max(20, min(int(limit or 100), 1000))
    try:
        df = await data_manager.get_ohlcv(sym, interval, limit)
        df = _compute_indicators(df)
        signal = _signal(df)
        return _sanitize({"symbol": sym, "interval": interval, "count": len(df), "data": _df_records(df), "signal": signal, "live_data_only": True})
    except LiveDataUnavailable as e:
        logger.warning("live history unavailable for %s %s: %s", sym, interval, e)
        raise HTTPException(503, str(e))
    except Exception as e:
        logger.exception("history endpoint failed for %s %s", sym, interval)
        raise HTTPException(500, str(e))

@app.get("/api/market/signal/{symbol}")
async def get_signal(symbol: str, timeframe: str = "1h"):
    sym = _sym(symbol)
    timeframe = str(timeframe or "1h")
    try:
        df = await data_manager.get_ohlcv(sym, interval=timeframe, limit=240)
        return _sanitize({**_signal(_compute_indicators(df)), "live_data_only": True})
    except LiveDataUnavailable as e:
        logger.warning("live signal unavailable for %s %s: %s", sym, timeframe, e)
        raise HTTPException(503, str(e))
    except Exception as e:
        logger.exception("signal endpoint failed for %s %s", sym, timeframe)
        raise HTTPException(500, str(e))

@app.get("/api/market/decision/{symbol}")
async def get_market_decision(symbol: str, timeframes: str = "15m,1h,4h,1d"):
    """Multi-timeframe signal consensus inspired by Vibe-Trading validation guardrails.

    The endpoint combines fast and slow timeframes instead of trusting a single
    indicator snapshot. It returns a conservative confidence if timeframes disagree.
    """
    sym = _sym(symbol)
    tfs = [t.strip() for t in str(timeframes or "1h").split(",") if t.strip()]
    tfs = tfs[:6] or ["1h"]
    weight_map = {"1m": 0.08, "5m": 0.10, "15m": 0.15, "30m": 0.18, "1h": 0.30, "4h": 0.25, "1d": 0.25, "1w": 0.15}
    frames = []
    total_w = 0.0
    weighted = 0.0
    confs = []
    last_risk = None
    for tf in tfs:
        try:
            df = await data_manager.get_ohlcv(sym, interval=tf, limit=260)
            sig = _signal(_compute_indicators(df))
            score = float(sig.get("score", 0) or 0)
            w = float(weight_map.get(tf, 0.15))
            weighted += score * w
            total_w += w
            confs.append(float(sig.get("confidence", 50) or 50))
            last_risk = sig.get("risk") or last_risk
            frames.append({"timeframe": tf, "signal": sig.get("signal"), "confidence": sig.get("confidence"), "score": round(score, 4), "quality": sig.get("quality", {})})
        except Exception as exc:
            frames.append({"timeframe": tf, "signal": "ERROR", "confidence": 0, "score": 0, "error": str(exc)})
    if total_w <= 0:
        raise HTTPException(503, "Live data unavailable for every requested timeframe")
    consensus_score = weighted / total_w
    bullish = sum(1 for f in frames if "BUY" in str(f.get("signal")))
    bearish = sum(1 for f in frames if "SELL" in str(f.get("signal")))
    disagreement = bullish > 0 and bearish > 0
    if consensus_score >= 0.55 and not disagreement:
        signal, base_conf = "STRONG BUY", 84
    elif consensus_score >= 0.25:
        signal, base_conf = "BUY", 68
    elif consensus_score <= -0.55 and not disagreement:
        signal, base_conf = "STRONG SELL", 82
    elif consensus_score <= -0.25:
        signal, base_conf = "SELL", 66
    else:
        signal, base_conf = "NEUTRAL", 52
    avg_conf = sum(confs) / len(confs) if confs else 50
    confidence = int(max(35, min(92, (base_conf * 0.65 + avg_conf * 0.35) - (12 if disagreement else 0))))
    reasons = []
    if disagreement:
        reasons.append("Timeframes disagree; confidence reduced")
    reasons.append(f"Consensus score {consensus_score:.3f} across {len(frames)} timeframe(s)")
    if bullish:
        reasons.append(f"Bullish frames: {bullish}")
    if bearish:
        reasons.append(f"Bearish frames: {bearish}")
    return _sanitize({"symbol": sym, "signal": signal, "confidence": confidence, "score": round(consensus_score, 4), "frames": frames, "risk": last_risk, "reasons": reasons, "timestamp": datetime.utcnow().isoformat()})

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
        return {"symbol": sym, "model": predictor.model_name, "mode": predictor.mode, "timestamp": now.isoformat(),
                "forecast": [{"t": i, "p": round(float(p),4),
                               "hi": round(float(p) + daily_vol*(1+i*0.12),4),
                               "lo": round(float(p) - daily_vol*(1+i*0.12),4),
                               "timestamp": (now+timedelta(hours=i+1)).isoformat()}
                             for i, p in enumerate(raw)]}
    except HTTPException: raise
    except Exception as e: raise HTTPException(500, str(e))

@app.get("/api/backtest/run")
async def run_backtest_py(symbol: str = "BTC/USDT", strategy: str = "rsi", interval: str = "1h", limit: int = 700,
                          initial_cash: float = 10000, fee_bps: float = 8, slippage_bps: float = 3,
                          max_position_pct: float = 95):
    try:
        sym = _sym(symbol)
        df = await data_manager.get_ohlcv(sym, interval=interval, limit=max(120, min(int(limit or 700), 1500)))
        if df.empty: raise HTTPException(400, "Not enough data")
        cfg = {"initial_cash": initial_cash, "fee_bps": fee_bps, "slippage_bps": slippage_bps, "max_position_pct": max_position_pct}
        return _sanitize({"symbol": sym, "interval": interval, **backtester.run(df, strategy=strategy, config=cfg, interval=interval)})
    except HTTPException: raise
    except Exception as e:
        logger.exception("backtest endpoint failed")
        raise HTTPException(500, str(e))

@app.get("/api/backtest/validate")
async def validate_backtest(symbol: str = "BTC/USDT", strategy: str = "rsi", interval: str = "1h", limit: int = 1000, folds: int = 4):
    try:
        sym = _sym(symbol)
        df = await data_manager.get_ohlcv(sym, interval=interval, limit=max(240, min(int(limit or 1000), 1500)))
        return _sanitize({"symbol": sym, "interval": interval, **backtester.walk_forward(df, strategy=strategy, interval=interval, folds=folds)})
    except Exception as e:
        logger.exception("walk-forward validation failed")
        raise HTTPException(500, str(e))

# ── News ─────────────────────────────────────────────────────────────────────

@app.get("/api/news")
async def get_news(symbols: str = "BTC,ETH,crypto", limit: int = 20):
    articles = []
    limit = max(1, min(int(limit or 20), 50))
    for sym in [x.strip() for x in symbols.split(",") if x.strip()]:
        try:
            res = await news_agent.analyze_news(sym)
            sentiment = res.get("sentiment", "neutral")
            ui = "positive" if sentiment == "bullish" else "negative" if sentiment == "bearish" else "neutral"
            for a in res.get("articles", []):
                articles.append({
                    "title": a.get("title", ""),
                    "summary": a.get("summary", ""),
                    "sentiment": ui,
                    "sentiment_score": a.get("sentiment_score", res.get("score", 0)),
                    "source": a.get("source", "live-feed"),
                    "impact": "Live",
                    "url": a.get("url", ""),
                    "symbol": sym,
                })
        except Exception as exc:
            logger.warning("News unavailable for %s: %s", sym, exc)
    # Empty list is intentional when live feeds have no matching items.
    return _sanitize({"data": articles[:limit], "count": len(articles[:limit]), "live_data_only": True, "timestamp": datetime.utcnow().isoformat()})

@app.get("/api/news/{symbol}")
async def get_symbol_news(symbol: str, limit: int = 10):
    try:
        res = await news_agent.analyze_news(symbol)
        sentiment = res.get("sentiment", "neutral")
        ui = "positive" if sentiment == "bullish" else "negative" if sentiment == "bearish" else "neutral"
        items = []
        for a in res.get("articles", [])[:max(1, min(int(limit or 10), 30))]:
            items.append({
                "title": a.get("title", ""),
                "summary": a.get("summary", ""),
                "sentiment": ui,
                "sentiment_score": a.get("sentiment_score", res.get("score", 0)),
                "source": a.get("source", "live-feed"),
                "impact": "Live",
                "url": a.get("url", ""),
            })
        return _sanitize({"data": items, "count": len(items), "live_data_only": True})
    except Exception as e:
        raise HTTPException(503, str(e))

# ── Portfolio ─────────────────────────────────────────────────────────────────

@app.get("/api/portfolio")
async def get_portfolio():
    """Return real account portfolio only.

    Without a configured broker/exchange account, returning empty data is safer
    than showing fake balances or fake P&L.
    """
    return {
        "connected": False,
        "source": "not_configured",
        "message": "No exchange/broker account is configured. Portfolio values are not fabricated.",
        "total_value": None,
        "total_pnl": None,
        "total_pnl_pct": None,
        "cash": None,
        "positions": [],
        "history": [],
        "live_data_only": True,
    }

# ── Bots ──────────────────────────────────────────────────────────────────────

@app.get("/api/bots")
async def get_bots():
    status = await ot.get_opentrader_status()
    bots = status.get("bots") or []
    return {"connected": bool(status.get("available") and status.get("connected")), "bots": bots, "source": "opentrader_api" if bots else "not_configured", "message": "No real OpenTrader bots returned." if not bots else "Live OpenTrader bots", "live_data_only": True}

@app.post("/api/bots/{bot_id}/toggle")
async def toggle_bot(bot_id: str):
    if not ot.is_available():
        raise HTTPException(503, "OpenTrader is not running; no simulated bot toggle is available")
    # Keep this endpoint conservative until the installed OpenTrader API shape is confirmed.
    raise HTTPException(501, "Live OpenTrader toggle endpoint is not mapped for this installation")

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
    result = await ot.run_opentrader_strategy(strategy, symbol, params, paper)
    if not result.get("ok", False):
        raise HTTPException(503, result.get("error", "OpenTrader unavailable"))
    return result

@app.post("/api/opentrader/backtest")
async def ot_backtest(data: Dict[str,Any]):
    return await ot.run_opentrader_backtest(
        data.get("strategy","grid"), data.get("symbol","BTC/USDT"),
        data.get("timeframe","1h"),  data.get("from_date","2024-01-01"),
        data.get("to_date","2024-06-01"), data.get("params",{}))

# ── Research / validation lab ─────────────────────────────────────────────────

@app.get("/api/research/status")
async def research_status():
    return research.status()

@app.get("/api/research/briefing")
async def research_briefing(query: str = "crypto stocks", limit: int = 12):
    return await research.rss_briefing(query=query, limit=limit)

@app.get("/api/research/read")
async def research_read(url: str):
    return await research.read_url(url)

@app.get("/api/research/github")
async def research_github(repo: str = "HKUDS/Vibe-Trading"):
    return await research.github_repo(repo)

@app.get("/api/portfolio/correlation")
async def portfolio_correlation(symbols: str = "BTC/USDT,ETH/USDT,SOL/USDT,BNB/USDT,AAPL,NVDA,TSLA,MSFT", interval: str = "1d", lookback: int = 120):
    frames = {}
    for s in [x.strip() for x in symbols.split(",") if x.strip()][:12]:
        try:
            frames[_sym(s)] = await data_manager.get_ohlcv(_sym(s), interval=interval, limit=max(30, min(int(lookback or 120), 400)))
        except Exception as exc:
            logger.warning("Correlation skipped %s: %s", s, exc)
    return _sanitize(correlator.compute(frames, lookback=lookback))

@app.get("/api/risk/position-size")
async def risk_position_size(symbol: str = "BTC/USDT", interval: str = "1h", account_equity: float = 10000, risk_pct: float = 1, atr_mult: float = 2, max_alloc_pct: float = 25):
    sym = _sym(symbol)
    try:
        df = await data_manager.get_ohlcv(sym, interval=interval, limit=180)
        return _sanitize({"symbol": sym, "interval": interval, **risk_engine.position_size(df, account_equity, risk_pct, atr_mult, max_alloc_pct)})
    except Exception as exc:
        return _sanitize({"symbol": sym, "ok": False, "error": str(exc)})

# ── System stats ──────────────────────────────────────────────────────────────

@app.get("/api/system/stats")
async def sys_stats():
    payload = {"live_data_only": True, "timestamp": datetime.utcnow().isoformat()}
    try:
        import psutil
        cpu = psutil.cpu_percent(interval=0.1)
        mem = psutil.virtual_memory()
        payload.update({"cpu": round(cpu,1), "memory_pct": round(mem.percent,1), "memory_used_gb": round(mem.used/1e9,2)})
    except Exception as exc:
        payload.update({"cpu": None, "memory_pct": None, "memory_used_gb": None, "system_error": str(exc)})
    payload.update({
        "kronos_status": "KRONOS" if predictor.is_ready else "STATISTICAL",
        "research_status": "LIVE_FEEDS",
        "agent_reach_status": "LOCAL_ADAPTER",
        "swarm_status": "ACTIVE",
        "opentrader_status": "LIVE" if ot.is_available() else "DISABLED",
    })
    return payload

# ── WebSockets ────────────────────────────────────────────────────────────────

@app.websocket("/ws/logs")
async def ws_logs(ws: WebSocket):
    await ws.accept()
    try:
        boot = [
            ("ok", "[System] QuantumAI v3.4 live-data-only mode"),
            ("info", "[Data] Real providers only: Binance + yfinance"),
            ("info", "[Policy] Mock/demo market data disabled"),
            ("info", "[OpenTrader] " + ("connected" if ot.is_available() else "not running — execution disabled")),
        ]
        for tp, msg in boot:
            await ws.send_text(json.dumps({"t": datetime.now().strftime("%H:%M:%S"), "tp": tp, "m": msg}))
            await asyncio.sleep(0.25)
        while True:
            await asyncio.sleep(15)
            status = "LIVE" if ot.is_available() else "DISABLED"
            await ws.send_text(json.dumps({"t": datetime.now().strftime("%H:%M:%S"), "tp": "info", "m": f"[Health] live-data-only heartbeat · OpenTrader {status}"}))
    except WebSocketDisconnect:
        pass

@app.websocket("/ws/market")
async def ws_market(ws: WebSocket):
    await ws.accept()
    try:
        while True:
            payload = await get_tickers()
            await ws.send_json({"type":"tickers","data": payload.get("data", [])})
            await asyncio.sleep(5)
    except WebSocketDisconnect: pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
