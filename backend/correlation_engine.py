"""Portfolio/cross-asset correlation helpers."""
from __future__ import annotations
from typing import Any, Dict, List
import numpy as np
import pandas as pd


class CorrelationEngine:
    @staticmethod
    def compute(price_frames: Dict[str, pd.DataFrame], lookback: int = 120) -> Dict[str, Any]:
        closes = []
        for symbol, df in price_frames.items():
            if df is None or df.empty or "close" not in df.columns:
                continue
            x = df[["timestamp", "close"]].copy()
            x["timestamp"] = pd.to_datetime(x["timestamp"], errors="coerce").dt.floor("min")
            x["close"] = pd.to_numeric(x["close"], errors="coerce")
            x = x.dropna().drop_duplicates("timestamp").set_index("timestamp").sort_index().tail(lookback)
            closes.append(x.rename(columns={"close": symbol}))
        if len(closes) < 2:
            return {"symbols": list(price_frames.keys()), "matrix": [], "pairs": [], "warning": "At least two symbols with data are required"}
        merged = pd.concat(closes, axis=1).ffill().dropna(how="all")
        returns = merged.pct_change().dropna(how="all")
        corr = returns.corr().replace([np.inf, -np.inf], np.nan).fillna(0)
        symbols = list(corr.columns)
        matrix = []
        pairs = []
        for a in symbols:
            row = []
            for b in symbols:
                val = float(corr.loc[a, b])
                row.append(round(val, 4))
                if a < b:
                    pairs.append({"a": a, "b": b, "corr": round(val, 4), "risk": "high" if abs(val) >= 0.75 else "medium" if abs(val) >= 0.45 else "low"})
            matrix.append(row)
        pairs.sort(key=lambda x: abs(x["corr"]), reverse=True)
        avg_abs = float(np.mean([abs(x["corr"]) for x in pairs])) if pairs else 0.0
        return {"symbols": symbols, "matrix": matrix, "pairs": pairs, "avg_abs_corr": round(avg_abs, 4), "observations": int(len(returns))}
