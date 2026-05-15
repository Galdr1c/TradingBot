"""
Enhanced trading agents with professional-grade technical analysis.
Inspired by OpenTrader (https://github.com/Open-Trader/opentrader) indicator implementations.
"""
import asyncio
from typing import List, Dict, Any, Optional
import numpy as np
from datetime import datetime
from candles import analyze_latest_candles


# ── Pure-math indicator helpers (no TA-lib / ta dependency) ─────────────────

def _ema(values: np.ndarray, period: int) -> np.ndarray:
    """Exponential Moving Average — same formula as TradingView / OpenTrader."""
    alpha = 2.0 / (period + 1)
    out = np.full(len(values), np.nan)
    # Seed with SMA of first `period` values
    if len(values) < period:
        return out
    out[period - 1] = np.mean(values[:period])
    for i in range(period, len(values)):
        out[i] = values[i] * alpha + out[i - 1] * (1 - alpha)
    return out


def _rsi_wilder(closes: np.ndarray, period: int = 14) -> np.ndarray:
    """
    Wilder's RSI — identical to how OpenTrader's RSI indicator works.
    Uses smoothed moving average (RMA) instead of simple average.
    """
    deltas = np.diff(closes)
    gain = np.where(deltas > 0, deltas, 0.0)
    loss = np.where(deltas < 0, -deltas, 0.0)

    out = np.full(len(closes), np.nan)
    if len(closes) <= period:
        return out

    # Initial seed: simple average
    avg_gain = np.mean(gain[:period])
    avg_loss = np.mean(loss[:period])

    for i in range(period, len(deltas)):
        avg_gain = (avg_gain * (period - 1) + gain[i]) / period  # Wilder smoothing
        avg_loss = (avg_loss * (period - 1) + loss[i]) / period
        rs = avg_gain / (avg_loss + 1e-10)
        idx = i + 1  # +1 because deltas is 1 shorter than closes
        out[idx] = 100 - (100 / (1 + rs))

    return out


def _macd(closes: np.ndarray, fast=12, slow=26, signal=9):
    """MACD line, signal line, histogram."""
    ema_fast = _ema(closes, fast)
    ema_slow = _ema(closes, slow)
    macd_line = ema_fast - ema_slow
    # Signal is EMA of MACD (only over valid values)
    valid_mask = ~np.isnan(macd_line)
    signal_line = np.full(len(closes), np.nan)
    if valid_mask.sum() >= signal:
        valid_idx = np.where(valid_mask)[0]
        tmp = _ema(macd_line[valid_mask], signal)
        signal_line[valid_idx] = tmp
    hist = macd_line - signal_line
    return macd_line, signal_line, hist


def _adx(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Average Directional Index — trend strength (OpenTrader uses this for trend confirmation)."""
    n = len(closes)
    out = np.full(n, np.nan)
    if n < period + 1:
        return out

    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    tr = np.zeros(n)

    for i in range(1, n):
        hl = highs[i] - lows[i]
        hpc = abs(highs[i] - closes[i - 1])
        lpc = abs(lows[i] - closes[i - 1])
        tr[i] = max(hl, hpc, lpc)
        up = highs[i] - highs[i - 1]
        dn = lows[i - 1] - lows[i]
        plus_dm[i] = up if up > dn and up > 0 else 0
        minus_dm[i] = dn if dn > up and dn > 0 else 0

    atr = np.full(n, np.nan)
    pdi = np.full(n, np.nan)
    mdi = np.full(n, np.nan)
    dx = np.full(n, np.nan)

    atr[period] = np.sum(tr[1:period + 1])
    pdi_sum = np.sum(plus_dm[1:period + 1])
    mdi_sum = np.sum(minus_dm[1:period + 1])

    for i in range(period + 1, n):
        atr[i] = atr[i - 1] - atr[i - 1] / period + tr[i]
        pdi_sum = pdi_sum - pdi_sum / period + plus_dm[i]
        mdi_sum = mdi_sum - mdi_sum / period + minus_dm[i]
        pdi[i] = 100 * pdi_sum / (atr[i] + 1e-10)
        mdi[i] = 100 * mdi_sum / (atr[i] + 1e-10)
        di_diff = abs(pdi[i] - mdi[i])
        di_sum = pdi[i] + mdi[i] + 1e-10
        dx[i] = 100 * di_diff / di_sum

    # Smooth DX → ADX
    out[2 * period] = np.nanmean(dx[period + 1: 2 * period + 1])
    for i in range(2 * period + 1, n):
        out[i] = (out[i - 1] * (period - 1) + dx[i]) / period

    return out


def _williams_r(highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> np.ndarray:
    """Williams %R — momentum oscillator used by OpenTrader RSI bot as confirmation."""
    out = np.full(len(closes), np.nan)
    for i in range(period - 1, len(closes)):
        hh = np.max(highs[i - period + 1: i + 1])
        ll = np.min(lows[i - period + 1: i + 1])
        out[i] = -100 * (hh - closes[i]) / (hh - ll + 1e-10)
    return out


def _vwap_approx(highs, lows, closes, volumes) -> float:
    """Approximate VWAP for the session."""
    tp = (highs + lows + closes) / 3
    return float(np.sum(tp * volumes) / (np.sum(volumes) + 1e-10))


def _bollinger(closes: np.ndarray, period: int = 20, std_dev: float = 2.0):
    """Bollinger Bands — upper, middle, lower."""
    middle = np.full(len(closes), np.nan)
    upper = np.full(len(closes), np.nan)
    lower = np.full(len(closes), np.nan)
    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1: i + 1]
        m = np.mean(window)
        s = np.std(window, ddof=1)
        middle[i] = m
        upper[i] = m + std_dev * s
        lower[i] = m - std_dev * s
    return upper, middle, lower


# ── OpenTrader-inspired Grid strategy calculator ─────────────────────────────

class GridCalculator:
    """
    Mirrors OpenTrader's GRID strategy logic.
    Generates buy/sell grid levels and calculates expected profit per grid.
    """
    @staticmethod
    def calculate(high: float, low: float, levels: int, qty_per_grid: float, current_price: float) -> dict:
        if levels < 2 or high <= low:
            return {"error": "Invalid grid parameters"}

        step = (high - low) / levels
        grid_prices = [round(low + i * step, 4) for i in range(levels + 1)]

        buy_orders = [p for p in grid_prices if p < current_price]
        sell_orders = [p for p in grid_prices if p > current_price]

        profit_per_grid = step * qty_per_grid
        total_investment = sum(buy_orders) * qty_per_grid if buy_orders else 0
        grid_roi_pct = (profit_per_grid / (current_price * qty_per_grid)) * 100 if current_price > 0 else 0

        return {
            "grid_prices": grid_prices,
            "buy_orders": buy_orders[-5:],   # nearest 5 below
            "sell_orders": sell_orders[:5],   # nearest 5 above
            "step_size": round(step, 4),
            "profit_per_grid": round(profit_per_grid, 4),
            "total_investment": round(total_investment, 2),
            "grid_roi_pct": round(grid_roi_pct, 4),
            "levels": levels,
        }


# ── OpenTrader-inspired DCA calculator ───────────────────────────────────────

class DCACalculator:
    """
    Mirrors OpenTrader's DCA strategy:
    Entry with multiple orders averaging down, exit on price swing.
    """
    @staticmethod
    def calculate(entry_price: float, drop_pct: float, orders: int, base_qty: float,
                  multiplier: float = 1.5, take_profit_pct: float = 2.0) -> dict:
        order_prices = []
        order_qtys = []
        qty = base_qty
        total_cost = 0.0
        total_qty = 0.0

        for i in range(orders):
            price = entry_price * (1 - drop_pct / 100 * i)
            order_prices.append(round(price, 4))
            order_qtys.append(round(qty, 6))
            total_cost += price * qty
            total_qty += qty
            qty *= multiplier

        avg_entry = total_cost / total_qty if total_qty > 0 else entry_price
        take_profit = avg_entry * (1 + take_profit_pct / 100)
        profit = (take_profit - avg_entry) * total_qty

        return {
            "orders": [{"price": p, "qty": q} for p, q in zip(order_prices, order_qtys)],
            "avg_entry": round(avg_entry, 4),
            "total_qty": round(total_qty, 6),
            "total_investment": round(total_cost, 2),
            "take_profit": round(take_profit, 4),
            "expected_profit": round(profit, 4),
            "take_profit_pct": take_profit_pct,
        }


# ── Enhanced Market Analyst Agent ────────────────────────────────────────────

class MarketAnalystAgent:
    """
    Professional technical analysis using proper indicator implementations
    mirroring OpenTrader's indicator package.
    """
    async def analyze(self, symbol: str, price_data: List[dict]) -> dict:
        if not price_data or len(price_data) < 30:
            return {"agent": "Market Analyst", "analysis": "Insufficient data (need 30+ candles)",
                    "sentiment": "neutral", "signal": "HOLD", "confidence": 50}

        closes = np.array([d['p'] for d in price_data if d.get('p')], dtype=float)
        opens  = np.array([d.get('o', d.get('open', d['p'])) for d in price_data if d.get('p')], dtype=float)
        highs  = np.array([d.get('h', d['p']) for d in price_data if d.get('p')], dtype=float)
        lows   = np.array([d.get('l', d['p']) for d in price_data if d.get('p')], dtype=float)
        vols   = np.array([d.get('v', 1) for d in price_data if d.get('p')], dtype=float)

        n = len(closes)
        last = closes[-1]

        # ── Core indicators ──────────────────────────────────────────────────
        rsi_arr = _rsi_wilder(closes, 14)
        rsi = float(rsi_arr[-1]) if not np.isnan(rsi_arr[-1]) else 50.0

        macd_line, signal_line, hist = _macd(closes, 12, 26, 9)
        macd_val  = float(macd_line[-1])  if not np.isnan(macd_line[-1])  else 0.0
        macd_sig  = float(signal_line[-1]) if not np.isnan(signal_line[-1]) else 0.0
        macd_hist = float(hist[-1])        if not np.isnan(hist[-1])        else 0.0
        prev_macd_hist = float(hist[-2]) if n > 1 and not np.isnan(hist[-2]) else 0.0

        adx_arr = _adx(highs, lows, closes, 14)
        adx = float(adx_arr[-1]) if not np.isnan(adx_arr[-1]) else 20.0

        wr_arr = _williams_r(highs, lows, closes, 14)
        wr = float(wr_arr[-1]) if not np.isnan(wr_arr[-1]) else -50.0

        bb_u, bb_m, bb_l = _bollinger(closes, 20, 2.0)
        bb_upper = float(bb_u[-1]) if not np.isnan(bb_u[-1]) else last * 1.02
        bb_lower = float(bb_l[-1]) if not np.isnan(bb_l[-1]) else last * 0.98
        bb_mid   = float(bb_m[-1]) if not np.isnan(bb_m[-1]) else last

        ema20 = float(_ema(closes, 20)[-1]) if n >= 20 else last
        ema50 = float(_ema(closes, 50)[-1]) if n >= 50 else last
        ema200 = float(_ema(closes, 200)[-1]) if n >= 200 else last

        vwap = _vwap_approx(highs, lows, closes, vols)
        candle = analyze_latest_candles(price_data)
        candle_score = float(candle.get("candle_score", 0.0))
        candle_signal = candle.get("candle_signal", "NEUTRAL")
        candle_pattern = candle.get("candle_pattern", "No clear pattern")
        vol_sma = float(np.mean(vols[-20:])) if n >= 20 else float(np.mean(vols))
        vol_ratio = float(vols[-1]) / (vol_sma + 1e-10)

        # ── Trend slope ──────────────────────────────────────────────────────
        window = min(20, n)
        x = np.arange(window)
        y = closes[-window:]
        slope = float(np.polyfit(x, y, 1)[0]) if window > 1 else 0.0
        trend_pct = (slope / (last + 1e-10)) * 100

        # ── Scoring system (OpenTrader-style weighted signals) ────────────────
        score = 0.0     # +ve = bullish, -ve = bearish
        max_score = 0.0
        reasons = []

        # RSI (weight 2)
        max_score += 2
        if rsi < 30:
            score += 2; reasons.append(f"RSI oversold: {rsi:.1f} — strong buy zone")
        elif rsi < 40:
            score += 1; reasons.append(f"RSI approaching oversold: {rsi:.1f}")
        elif rsi > 70:
            score -= 2; reasons.append(f"RSI overbought: {rsi:.1f} — take profit zone")
        elif rsi > 60:
            score -= 1; reasons.append(f"RSI elevated: {rsi:.1f}")

        # MACD crossover (weight 2)
        max_score += 2
        if macd_val > macd_sig and prev_macd_hist < 0 and macd_hist > 0:
            score += 2; reasons.append("MACD bullish crossover (histogram flip)")
        elif macd_val > macd_sig:
            score += 1; reasons.append(f"MACD above signal: {macd_val:.4f}")
        elif macd_val < macd_sig and prev_macd_hist > 0 and macd_hist < 0:
            score -= 2; reasons.append("MACD bearish crossover (histogram flip)")
        elif macd_val < macd_sig:
            score -= 1; reasons.append(f"MACD below signal: {macd_val:.4f}")

        # ADX trend strength (weight 1.5)
        max_score += 1.5
        if adx > 25:
            if trend_pct > 0:
                score += 1.5; reasons.append(f"ADX {adx:.1f} — strong uptrend confirmed")
            else:
                score -= 1.5; reasons.append(f"ADX {adx:.1f} — strong downtrend confirmed")
        elif adx > 20:
            if trend_pct > 0:
                score += 0.7; reasons.append(f"ADX {adx:.1f} — moderate uptrend")
            else:
                score -= 0.7; reasons.append(f"ADX {adx:.1f} — moderate downtrend")

        # EMA stack (weight 1.5)
        max_score += 1.5
        if ema20 > ema50 > ema200 and last > ema20:
            score += 1.5; reasons.append("Bullish EMA stack (20>50>200), price above EMA20")
        elif ema20 < ema50 < ema200 and last < ema20:
            score -= 1.5; reasons.append("Bearish EMA stack (20<50<200), price below EMA20")
        elif ema20 > ema50:
            score += 0.7; reasons.append("Short-term uptrend: EMA20 > EMA50")
        elif ema20 < ema50:
            score -= 0.7; reasons.append("Short-term downtrend: EMA20 < EMA50")

        # Bollinger Band position (weight 1)
        max_score += 1
        bb_pct = (last - bb_lower) / (bb_upper - bb_lower + 1e-10)
        if bb_pct < 0.15:
            score += 1; reasons.append(f"Price near lower BB ({bb_pct:.1%}) — oversold squeeze")
        elif bb_pct > 0.85:
            score -= 1; reasons.append(f"Price near upper BB ({bb_pct:.1%}) — overbought")

        # Williams %R (weight 1)
        max_score += 1
        if wr < -80:
            score += 1; reasons.append(f"Williams %R oversold: {wr:.1f}")
        elif wr > -20:
            score -= 1; reasons.append(f"Williams %R overbought: {wr:.1f}")

        # Volume confirmation (weight 1)
        max_score += 1
        if vol_ratio > 1.5 and trend_pct > 0:
            score += 1; reasons.append(f"Volume surge ({vol_ratio:.1f}x avg) confirms upside")
        elif vol_ratio > 1.5 and trend_pct < 0:
            score -= 1; reasons.append(f"Volume surge ({vol_ratio:.1f}x avg) confirms downside")

        # Candlestick pattern confirmation (weight 1.2)
        max_score += 1.2
        if candle_signal == "BULLISH":
            score += min(1.2, abs(candle_score) * 0.6)
            reasons.append(f"Candlestick bullish: {candle_pattern}")
        elif candle_signal == "BEARISH":
            score -= min(1.2, abs(candle_score) * 0.6)
            reasons.append(f"Candlestick bearish: {candle_pattern}")

        # VWAP position (weight 0.5)
        max_score += 0.5
        if last > vwap * 1.002:
            score += 0.5; reasons.append(f"Price above VWAP (${vwap:.2f})")
        elif last < vwap * 0.998:
            score -= 0.5; reasons.append(f"Price below VWAP (${vwap:.2f})")

        # ── Signal determination ─────────────────────────────────────────────
        norm = score / (max_score + 1e-10)  # -1..+1

        if norm >= 0.55:
            sentiment, signal, base_conf = "bullish", "STRONG BUY", 88
        elif norm >= 0.25:
            sentiment, signal, base_conf = "bullish", "BUY", 72
        elif norm <= -0.55:
            sentiment, signal, base_conf = "bearish", "STRONG SELL", 85
        elif norm <= -0.25:
            sentiment, signal, base_conf = "bearish", "SELL", 68
        else:
            sentiment, signal, base_conf = "neutral", "HOLD", 52

        # Boost confidence if ADX confirms strong trend
        confidence = base_conf + (5 if adx > 30 else 0)
        confidence = min(95, max(35, confidence))

        # Brief summary for the card
        analysis = (
            f"RSI {rsi:.1f} | MACD {'▲' if macd_val > macd_sig else '▼'} | "
            f"ADX {adx:.1f} {'(trend)' if adx > 25 else '(ranging)'} | "
            f"BB {bb_pct:.0%} | Williams %R {wr:.1f} | "
            f"Candle {candle_signal}: {candle_pattern} | "
            f"Vol {vol_ratio:.1f}x avg | Score {norm:+.2f}"
        )

        return {
            "agent": "Market Analyst",
            "analysis": analysis,
            "sentiment": sentiment,
            "signal": signal,
            "confidence": confidence,
            "metrics": {
                "rsi": round(rsi, 2),
                "macd": round(macd_val, 4),
                "macd_hist": round(macd_hist, 4),
                "adx": round(adx, 2),
                "williams_r": round(wr, 2),
                "ema20": round(ema20, 2),
                "ema50": round(ema50, 2),
                "bb_pct": round(bb_pct * 100, 1),
                "vwap": round(vwap, 2),
                "vol_ratio": round(vol_ratio, 2),
                "trend_slope_pct": round(trend_pct, 3),
                "candle_score": round(candle_score, 3),
                "candle_signal": candle_signal,
                "candle_pattern": candle_pattern,
            },
            "reasons": reasons[:5],   # top 5 reasons for the signal
        }


# ── Enhanced News Agent ───────────────────────────────────────────────────────

class NewsAggregatorAgent:
    """
    News sentiment agent with expanded keyword matching
    and weighted impact scoring.
    """

    BULLISH_KEYWORDS = {
        'high': ['breakout', 'all-time high', 'ath', 'institutional', 'etf approved', 'adoption', 'partnership', 'upgrade'],
        'medium': ['bull', 'surge', 'rally', 'rise', 'gain', 'growth', 'profit', 'buy', 'accumulate', 'support'],
        'low': ['positive', 'good', 'increase', 'up', 'recover', 'rebound'],
    }
    BEARISH_KEYWORDS = {
        'high': ['hack', 'exploit', 'sec', 'ban', 'crash', 'regulatory', 'fraud', 'scam', 'liquidation'],
        'medium': ['bear', 'drop', 'fall', 'dump', 'loss', 'sell', 'decline', 'fear', 'risk', 'warning'],
        'low': ['negative', 'bad', 'decrease', 'down', 'correction'],
    }

    def _score_text(self, text: str) -> float:
        text = text.lower()
        score = 0.0
        for impact, words in self.BULLISH_KEYWORDS.items():
            w = {'high': 3, 'medium': 1.5, 'low': 0.5}[impact]
            for word in words:
                if word in text: score += w
        for impact, words in self.BEARISH_KEYWORDS.items():
            w = {'high': 3, 'medium': 1.5, 'low': 0.5}[impact]
            for word in words:
                if word in text: score -= w
        # Normalize to [-1, 1] softly
        return max(-1.0, min(1.0, score / 10.0))

    async def analyze_news(self, symbol: str, news_context: list = None) -> dict:
        if news_context and len(news_context) > 0:
            scores = []
            for article in news_context[:10]:
                text = article.get('title', '') + ' ' + article.get('summary', '')
                scores.append(self._score_text(text))

            avg_score = float(np.mean(scores)) if scores else 0.0

            if avg_score > 0.15:
                sentiment = "bullish"
                summary = f"Positive news flow for {symbol}. Weighted sentiment {avg_score:+.3f}."
            elif avg_score < -0.15:
                sentiment = "bearish"
                summary = f"Negative news flow for {symbol}. Weighted sentiment {avg_score:+.3f}."
            else:
                sentiment = "neutral"
                summary = f"Mixed/neutral news for {symbol}. Sentiment {avg_score:+.3f}."

            findings = [
                {
                    "src": a.get('source', 'News'),
                    "text": a.get('title', '')[:100],
                    "impact": "High" if abs(self._score_text(a.get('title',''))) > 0.3 else "Medium",
                    "sentiment": "positive" if self._score_text(a.get('title','')) > 0 else "negative"
                }
                for a in news_context[:5]
            ]
        else:
            avg_score = 0.0
            sentiment = "neutral"
            summary = f"No live news context for {symbol}. Defaulting to neutral."
            findings = []

        return {
            "agent": "News Aggregator",
            "findings": findings,
            "sentiment": sentiment,
            "summary": summary,
            "sentiment_score": round(avg_score, 4),
            "article_count": len(news_context) if news_context else 0,
        }


# ── Enhanced Risk Manager ─────────────────────────────────────────────────────

class RiskManagerAgent:
    """
    Portfolio risk management with VaR, CVaR, Sharpe proxy,
    and OpenTrader-compatible position sizing formulas.
    """

    async def assess_risk(self, symbol: str, price_data: List[dict], portfolio_pct: float = 5.0) -> dict:
        if not price_data or len(price_data) < 20:
            return {"agent": "Risk Manager", "status": "INSUFFICIENT_DATA",
                    "risk_level": "MEDIUM", "recommendation": "Need more data."}

        prices = np.array([d['p'] for d in price_data if d.get('p')], dtype=float)
        vols   = np.array([d.get('v', 1) for d in price_data if d.get('p')], dtype=float)
        returns = np.diff(np.log(prices + 1e-10))
        last = prices[-1]

        # Volatility (annualised from hourly data)
        daily_vol = float(np.std(returns) * np.sqrt(24))
        annual_vol = daily_vol * np.sqrt(252)

        # Max drawdown
        peak, max_dd = prices[0], 0.0
        for p in prices:
            if p > peak: peak = p
            dd = (peak - p) / (peak + 1e-10)
            if dd > max_dd: max_dd = dd

        # Value at Risk 95% & CVaR (Expected Shortfall)
        var_95 = float(np.percentile(returns, 5))
        cvar_95 = float(np.mean(returns[returns <= var_95])) if any(returns <= var_95) else var_95

        # Sharpe proxy (annualised)
        mean_ret = float(np.mean(returns) * 24 * 252)
        sharpe = mean_ret / (annual_vol + 1e-10)

        # Volume-based liquidity check
        avg_vol = float(np.mean(vols))
        vol_score = "Good" if avg_vol > 1e6 else "Low"

        # Kelly Criterion inspired position sizing
        win_rate = 0.55 if sharpe > 0 else 0.45   # rough estimate
        risk_reward = 1.5
        kelly_pct = win_rate - (1 - win_rate) / risk_reward
        kelly_pct = max(0, min(kelly_pct, 0.25))   # cap at 25%
        suggested_pct = round(min(portfolio_pct, kelly_pct * 100), 1)

        # Classify risk
        if daily_vol > 0.07 or max_dd > 0.20 or annual_vol > 0.80:
            risk_level = "HIGH"
            status = "CAUTION"
            recommendation = (
                f"⚠ High vol: {daily_vol*100:.1f}%/day, {max_dd*100:.1f}% drawdown. "
                f"Reduce position. Suggested: {suggested_pct}% of portfolio."
            )
        elif daily_vol > 0.03 or max_dd > 0.08 or annual_vol > 0.40:
            risk_level = "MEDIUM"
            status = "MONITOR"
            recommendation = (
                f"Moderate risk: {daily_vol*100:.1f}%/day vol. "
                f"VaR(95%): {abs(var_95)*100:.2f}%. Suggested: {suggested_pct}% of portfolio."
            )
        else:
            risk_level = "LOW"
            status = "SAFE"
            recommendation = (
                f"Low vol environment: {daily_vol*100:.1f}%/day. "
                f"Sharpe proxy: {sharpe:.2f}. Suggested: {suggested_pct}% of portfolio."
            )

        return {
            "agent": "Risk Manager",
            "status": status,
            "risk_level": risk_level,
            "recommendation": recommendation,
            "metrics": {
                "daily_vol_pct": round(daily_vol * 100, 2),
                "annual_vol_pct": round(annual_vol * 100, 2),
                "max_drawdown_pct": round(max_dd * 100, 2),
                "var_95_pct": round(abs(var_95) * 100, 2),
                "cvar_95_pct": round(abs(cvar_95) * 100, 2),
                "sharpe_proxy": round(sharpe, 3),
                "kelly_pct": round(kelly_pct * 100, 1),
                "suggested_position_pct": suggested_pct,
                "liquidity": vol_score,
            },
        }


# ── OpenTrader-inspired Strategy Agent ───────────────────────────────────────

class OpenTraderStrategyAgent:
    """
    Implements OpenTrader's three core strategies as signal generators:
    GRID, DCA, and RSI — same logic the CLI bot uses.
    """

    async def evaluate_grid(self, symbol: str, price_data: List[dict],
                            high: float, low: float, levels: int = 20) -> dict:
        current = price_data[-1]['p'] if price_data else (high + low) / 2
        grid = GridCalculator.calculate(high, low, levels, 0.001, current)

        # Signal: where are we in the grid?
        if current < (high + low) / 2:
            signal = "BUY"
            analysis = f"Price {current:.2f} in lower half of grid. Next buy at {grid['buy_orders'][-1] if grid['buy_orders'] else 'N/A'}."
        else:
            signal = "SELL"
            analysis = f"Price {current:.2f} in upper half of grid. Next sell at {grid['sell_orders'][0] if grid['sell_orders'] else 'N/A'}."

        return {
            "strategy": "GRID",
            "signal": signal,
            "grid_config": grid,
            "analysis": analysis,
        }

    async def evaluate_dca(self, symbol: str, price_data: List[dict],
                           drop_pct: float = 3.0, orders: int = 5) -> dict:
        if not price_data: return {"strategy": "DCA", "signal": "HOLD"}
        current = price_data[-1]['p']
        prices = np.array([d['p'] for d in price_data], dtype=float)
        recent_drop = (prices[-1] - prices[-10]) / prices[-10] * 100 if len(prices) > 10 else 0

        dca = DCACalculator.calculate(current, drop_pct, orders, 0.001, 1.5, 2.0)
        signal = "BUY" if recent_drop < -drop_pct else "WAIT"
        analysis = (
            f"DCA {'trigger' if signal == 'BUY' else 'standby'}: "
            f"Drop {recent_drop:.1f}%. Avg entry: ${dca['avg_entry']}, "
            f"TP: ${dca['take_profit']} (+{dca['take_profit_pct']}%)."
        )
        return {"strategy": "DCA", "signal": signal, "dca_config": dca, "analysis": analysis}

    async def evaluate_rsi(self, symbol: str, price_data: List[dict],
                           oversold: float = 30, overbought: float = 70) -> dict:
        if not price_data or len(price_data) < 15:
            return {"strategy": "RSI", "signal": "HOLD", "confidence": 50}

        prices = np.array([d['p'] for d in price_data], dtype=float)
        rsi_arr = _rsi_wilder(prices, 14)
        rsi = float(rsi_arr[-1]) if not np.isnan(rsi_arr[-1]) else 50.0
        prev_rsi = float(rsi_arr[-2]) if not np.isnan(rsi_arr[-2]) else rsi

        # OpenTrader RSI bot: enter when RSI crosses oversold from below, exit at overbought
        if prev_rsi < oversold and rsi >= oversold:
            signal = "BUY"; conf = 82
            analysis = f"RSI crossed above oversold ({oversold}) → {rsi:.1f}. OpenTrader entry signal."
        elif rsi < oversold:
            signal = "BUY"; conf = 70
            analysis = f"RSI in oversold zone: {rsi:.1f} < {oversold}. Accumulate."
        elif prev_rsi < overbought and rsi >= overbought:
            signal = "SELL"; conf = 80
            analysis = f"RSI crossed into overbought ({overbought}) → {rsi:.1f}. OpenTrader exit signal."
        elif rsi > overbought:
            signal = "SELL"; conf = 68
            analysis = f"RSI overbought: {rsi:.1f} > {overbought}. Take profit."
        else:
            signal = "HOLD"; conf = 52
            analysis = f"RSI neutral: {rsi:.1f}. Awaiting crossover above {oversold} or below {overbought}."

        return {
            "strategy": "RSI",
            "signal": signal,
            "confidence": conf,
            "rsi": round(rsi, 2),
            "analysis": analysis,
        }


# ── Kronos Strategy Synthesizer ───────────────────────────────────────────────

class KronosStrategyAgent:
    """
    Synthesises signals from all agents using a weighted confidence system.
    Takes OpenTrader strategy evaluations into account.
    """

    async def synthesize(self, symbol: str, analyst: dict, news: dict,
                         risk: dict, ot_signals: Optional[List[dict]] = None) -> dict:
        votes = []  # (direction, weight)

        # Technical analyst vote (weight 3)
        sig = analyst.get('signal', 'HOLD')
        conf = analyst.get('confidence', 50) / 100
        if 'BUY' in sig:   votes.append((1,  3 * conf))
        elif 'SELL' in sig: votes.append((-1, 3 * conf))
        else:               votes.append((0,  1))

        # News vote (weight 1.5)
        ns = news.get('sentiment', 'neutral')
        ns_score = news.get('sentiment_score', 0)
        if ns == 'bullish':   votes.append((1,  1.5 * (0.5 + abs(ns_score))))
        elif ns == 'bearish': votes.append((-1, 1.5 * (0.5 + abs(ns_score))))
        else:                  votes.append((0,  0.5))

        # Risk modifier (not a vote, a multiplier)
        risk_mult = {'LOW': 1.15, 'MEDIUM': 1.0, 'HIGH': 0.65}.get(risk.get('risk_level','MEDIUM'), 1.0)

        # OpenTrader strategy votes (weight 1 each)
        if ot_signals:
            for ots in ot_signals:
                s = ots.get('signal', 'HOLD')
                c = ots.get('confidence', 55) / 100
                if 'BUY' in s:   votes.append((1,  1.0 * c))
                elif 'SELL' in s: votes.append((-1, 1.0 * c))

        # Weighted average
        total_weight = sum(abs(w) for _, w in votes)
        agg = sum(d * w for d, w in votes) / (total_weight + 1e-10)
        agg = agg * risk_mult  # apply risk scaling

        # Confidence = weighted certainty of the direction
        raw_conf = int(abs(agg) * 100)
        confidence = min(95, max(30, raw_conf))

        if agg >= 0.50:    final = "STRONG BUY"
        elif agg >= 0.20:  final = "BUY"
        elif agg <= -0.50: final = "STRONG SELL"
        elif agg <= -0.20: final = "SELL"
        else:              final = "HOLD"

        ot_summary = ", ".join(f"{s['strategy']}:{s['signal']}" for s in ot_signals) if ot_signals else "N/A"

        return {
            "agent": "Kronos Strategy AI",
            "final_signal": final,
            "confidence": confidence,
            "reasoning": (
                f"Tech: {analyst.get('signal','?')} ({analyst.get('confidence',0)}%) | "
                f"News: {news.get('sentiment','?')} ({news.get('sentiment_score',0):+.3f}) | "
                f"Risk: {risk.get('risk_level','?')} (×{risk_mult}) | "
                f"OpenTrader: {ot_summary} → {final}"
            ),
            "signal_score": round(agg, 4),
            "risk_adjusted": True,
        }


# ── Trading Swarm Coordinator ─────────────────────────────────────────────────

class TradingSwarm:
    def __init__(self):
        self.analyst = MarketAnalystAgent()
        self.news_agent = NewsAggregatorAgent()
        self.risk_manager = RiskManagerAgent()
        self.ot_strategy = OpenTraderStrategyAgent()
        self.strategy = KronosStrategyAgent()

    async def run_cycle(self, symbol: str, price_data: List[dict],
                        news_context: list = None) -> list:
        if not price_data:
            return []

        prices = [d['p'] for d in price_data if d.get('p')]
        last_price = prices[-1] if prices else 0
        price_range_hi = max(prices[-50:]) if len(prices) >= 50 else last_price * 1.05
        price_range_lo = min(prices[-50:]) if len(prices) >= 50 else last_price * 0.95

        # Run core agents concurrently
        analyst_res, news_res, risk_res, grid_res, dca_res, rsi_res = await asyncio.gather(
            self.analyst.analyze(symbol, price_data),
            self.news_agent.analyze_news(symbol, news_context),
            self.risk_manager.assess_risk(symbol, price_data),
            self.ot_strategy.evaluate_grid(symbol, price_data, price_range_hi, price_range_lo, 20),
            self.ot_strategy.evaluate_dca(symbol, price_data, 3.0, 5),
            self.ot_strategy.evaluate_rsi(symbol, price_data, 30, 70),
        )

        ot_signals = [grid_res, dca_res, rsi_res]
        strategy_res = await self.strategy.synthesize(
            symbol, analyst_res, news_res, risk_res, ot_signals
        )

        return [analyst_res, news_res, risk_res, strategy_res]
