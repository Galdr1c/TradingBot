"""Risk guardrails and position sizing."""
from __future__ import annotations
from typing import Any, Dict
import math
import pandas as pd


def _atr(df: pd.DataFrame, period: int = 14) -> float:
    high = pd.to_numeric(df["high"], errors="coerce")
    low = pd.to_numeric(df["low"], errors="coerce")
    close = pd.to_numeric(df["close"], errors="coerce")
    tr = pd.concat([(high-low).abs(), (high-close.shift(1)).abs(), (low-close.shift(1)).abs()], axis=1).max(axis=1)
    val = tr.ewm(alpha=1/period, min_periods=period, adjust=False).mean().iloc[-1]
    return float(val) if math.isfinite(float(val)) else float((high.iloc[-1]-low.iloc[-1]))


class RiskEngine:
    @staticmethod
    def position_size(df: pd.DataFrame, account_equity: float = 10000, risk_pct: float = 1.0, atr_mult: float = 2.0, max_alloc_pct: float = 25.0) -> Dict[str, Any]:
        if df is None or df.empty:
            return {"ok": False, "error": "No data"}
        close = float(pd.to_numeric(df["close"], errors="coerce").dropna().iloc[-1])
        atr = max(_atr(df), close * 0.002)
        equity = max(0.0, float(account_equity or 10000))
        risk_pct = min(10.0, max(0.05, float(risk_pct or 1.0)))
        atr_mult = min(10.0, max(0.5, float(atr_mult or 2.0)))
        max_alloc_pct = min(100.0, max(1.0, float(max_alloc_pct or 25.0)))
        risk_amount = equity * risk_pct / 100.0
        stop_distance = atr * atr_mult
        qty_by_risk = risk_amount / stop_distance if stop_distance > 0 else 0.0
        qty_by_alloc = (equity * max_alloc_pct / 100.0) / close if close > 0 else 0.0
        qty = min(qty_by_risk, qty_by_alloc)
        notional = qty * close
        return {
            "ok": True,
            "last_price": round(close, 6),
            "atr": round(atr, 6),
            "atr_pct": round(atr / close * 100, 3) if close else 0,
            "stop_distance": round(stop_distance, 6),
            "long_stop": round(close - stop_distance, 6),
            "short_stop": round(close + stop_distance, 6),
            "risk_amount": round(risk_amount, 2),
            "quantity": round(qty, 8),
            "notional": round(notional, 2),
            "max_allocation_pct": max_alloc_pct,
            "note": "Educational sizing based on ATR; does not place orders.",
        }
