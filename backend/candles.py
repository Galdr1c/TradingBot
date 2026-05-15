"""
Candlestick analysis helpers for QuantumAI TradingBot.

Pure-Python / NumPy implementation; no TA-Lib dependency.  The detector is
intended as a confirmation layer, not a standalone trading rule.
"""
from __future__ import annotations

from typing import Dict, Iterable, List, Sequence
import math
import numpy as np
import pandas as pd


def _safe_float(x, default: float = 0.0) -> float:
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except Exception:
        return default


def _trend(closes: Sequence[float], idx: int, lookback: int = 5) -> float:
    start = max(0, idx - lookback)
    if idx <= start:
        return 0.0
    first = _safe_float(closes[start])
    last = _safe_float(closes[idx - 1], first)
    return (last - first) / (abs(first) + 1e-10)


def _candle_shape(o: float, h: float, l: float, c: float) -> Dict[str, float | bool]:
    rng = max(h - l, 1e-10)
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    return {
        "range": rng,
        "body": body,
        "upper": max(0.0, upper),
        "lower": max(0.0, lower),
        "body_pct": body / rng,
        "upper_pct": max(0.0, upper) / rng,
        "lower_pct": max(0.0, lower) / rng,
        "bull": c > o,
        "bear": c < o,
    }


def detect_candlestick_patterns(
    opens: Iterable[float],
    highs: Iterable[float],
    lows: Iterable[float],
    closes: Iterable[float],
) -> List[Dict[str, object]]:
    """Return one pattern/score object per candle.

    Score range is clipped to [-3, +3]. Positive scores are bullish, negative
    scores are bearish.  Crypto markets rarely have clean gaps, so three-candle
    formations are implemented using relative body position instead of hard gap
    requirements.
    """
    o = np.asarray(list(opens), dtype=float)
    h = np.asarray(list(highs), dtype=float)
    l = np.asarray(list(lows), dtype=float)
    c = np.asarray(list(closes), dtype=float)
    n = min(len(o), len(h), len(l), len(c))
    out: List[Dict[str, object]] = []

    for i in range(n):
        oi, hi, li, ci = map(_safe_float, (o[i], h[i], l[i], c[i]))
        s = _candle_shape(oi, hi, li, ci)
        names: List[str] = []
        score = 0.0
        strength = 0.0
        prev_trend = _trend(c, i, 5)

        # Single-candle formations.
        if s["body_pct"] <= 0.10:
            names.append("Doji / indecision")
            strength = max(strength, 0.25)

        if s["body_pct"] <= 0.38 and s["lower"] >= max(s["body"] * 2.0, s["range"] * 0.30) and s["upper_pct"] <= 0.25:
            if prev_trend <= 0:
                names.append("Hammer")
                score += 0.85
            else:
                names.append("Hanging Man")
                score -= 0.65
            strength = max(strength, min(1.0, s["lower_pct"] * 1.35))

        if s["body_pct"] <= 0.38 and s["upper"] >= max(s["body"] * 2.0, s["range"] * 0.30) and s["lower_pct"] <= 0.25:
            if prev_trend <= 0:
                names.append("Inverted Hammer")
                score += 0.55
            else:
                names.append("Shooting Star")
                score -= 0.85
            strength = max(strength, min(1.0, s["upper_pct"] * 1.35))

        # Two-candle formations.
        if i >= 1:
            po, pc = _safe_float(o[i - 1]), _safe_float(c[i - 1])
            prev_body = abs(pc - po)
            cur_body = abs(ci - oi)
            prev_bear = pc < po
            prev_bull = pc > po
            cur_bull = ci > oi
            cur_bear = ci < oi
            prev_body_high = max(po, pc)
            prev_body_low = min(po, pc)
            cur_body_high = max(oi, ci)
            cur_body_low = min(oi, ci)

            if prev_bear and cur_bull and cur_body_high >= prev_body_high and cur_body_low <= prev_body_low and cur_body > prev_body * 0.8:
                names.append("Bullish Engulfing")
                score += 1.25
                strength = max(strength, min(1.0, cur_body / (prev_body + 1e-10)))

            if prev_bull and cur_bear and cur_body_high >= prev_body_high and cur_body_low <= prev_body_low and cur_body > prev_body * 0.8:
                names.append("Bearish Engulfing")
                score -= 1.25
                strength = max(strength, min(1.0, cur_body / (prev_body + 1e-10)))

            if prev_bear and cur_bull and ci > (po + pc) / 2 and oi < pc:
                names.append("Piercing Line")
                score += 0.85
                strength = max(strength, 0.65)

            if prev_bull and cur_bear and ci < (po + pc) / 2 and oi > pc:
                names.append("Dark Cloud Cover")
                score -= 0.85
                strength = max(strength, 0.65)

            if prev_body > 0 and cur_body < prev_body * 0.45 and cur_body_high < prev_body_high and cur_body_low > prev_body_low:
                if prev_bear and cur_bull:
                    names.append("Bullish Harami")
                    score += 0.55
                elif prev_bull and cur_bear:
                    names.append("Bearish Harami")
                    score -= 0.55
                strength = max(strength, 0.45)

        # Three-candle formations.
        if i >= 2:
            o1, c1 = _safe_float(o[i - 2]), _safe_float(c[i - 2])
            o2, c2 = _safe_float(o[i - 1]), _safe_float(c[i - 1])
            body1 = abs(c1 - o1)
            body2 = abs(c2 - o2)
            body3 = abs(ci - oi)
            mid1 = (o1 + c1) / 2
            big_first = body1 > s["range"] * 0.25
            small_middle = body2 < max(body1, body3, 1e-10) * 0.55

            if c1 < o1 and small_middle and ci > oi and ci > mid1 and big_first:
                names.append("Morning Star")
                score += 1.35
                strength = max(strength, 0.80)

            if c1 > o1 and small_middle and ci < oi and ci < mid1 and big_first:
                names.append("Evening Star")
                score -= 1.35
                strength = max(strength, 0.80)

            if c1 < o1 and c2 < o2 and ci < oi and c1 > c2 > ci:
                names.append("Three Black Crows")
                score -= 1.40
                strength = max(strength, 0.85)

            if c1 > o1 and c2 > o2 and ci > oi and c1 < c2 < ci:
                names.append("Three White Soldiers")
                score += 1.40
                strength = max(strength, 0.85)

        score = max(-3.0, min(3.0, score))
        if score > 0.20:
            signal = "BULLISH"
        elif score < -0.20:
            signal = "BEARISH"
        else:
            signal = "NEUTRAL"

        out.append({
            "candle_pattern": ", ".join(names) if names else "No clear pattern",
            "candle_signal": signal,
            "candle_score": round(score, 3),
            "candle_strength": round(float(max(strength, min(1.0, abs(score) / 2.0))), 3),
        })
    return out


def add_candlestick_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Attach candlestick pattern columns to an OHLCV dataframe."""
    required = {"open", "high", "low", "close"}
    if df is None or df.empty or not required.issubset(df.columns):
        return df
    patterns = detect_candlestick_patterns(df["open"], df["high"], df["low"], df["close"])
    for col in ("candle_pattern", "candle_signal", "candle_score", "candle_strength"):
        df[col] = [p[col] for p in patterns]
    return df


def analyze_latest_candles(price_data: List[dict]) -> Dict[str, object]:
    """Analyze latest candle from normalized price_data dictionaries.

    Expected keys: o/h/l/p, where p is close.  If open is missing, the previous
    close is used as a safe approximation.
    """
    if not price_data:
        return {"candle_pattern": "No data", "candle_signal": "NEUTRAL", "candle_score": 0.0, "candle_strength": 0.0}

    opens, highs, lows, closes = [], [], [], []
    prev_close = None
    for row in price_data:
        close = _safe_float(row.get("p", row.get("close", prev_close or 0.0)))
        open_ = _safe_float(row.get("o", row.get("open", prev_close if prev_close is not None else close)), close)
        high = _safe_float(row.get("h", row.get("high", max(open_, close))), max(open_, close))
        low = _safe_float(row.get("l", row.get("low", min(open_, close))), min(open_, close))
        opens.append(open_); highs.append(high); lows.append(low); closes.append(close)
        prev_close = close

    patterns = detect_candlestick_patterns(opens, highs, lows, closes)
    return patterns[-1] if patterns else {"candle_pattern": "No data", "candle_signal": "NEUTRAL", "candle_score": 0.0, "candle_strength": 0.0}
