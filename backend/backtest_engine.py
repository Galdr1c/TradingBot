"""Robust, dependency-light backtesting engine for QuantumAI TradingBot v3.3.

This module intentionally avoids using future candles in signal execution: signals are
computed at candle close and positions are applied from the next candle onward. It is
not a live trading engine and does not promise profitability.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Dict, List, Optional
import math
import numpy as np
import pandas as pd


def _safe_float(x: Any, default: float = 0.0) -> float:
    try:
        v = float(x)
        if math.isnan(v) or math.isinf(v):
            return default
        return v
    except Exception:
        return default


def _ema(series: pd.Series, span: int) -> pd.Series:
    return pd.to_numeric(series, errors="coerce").ewm(span=span, adjust=False, min_periods=max(2, span // 2)).mean()


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    close = pd.to_numeric(close, errors="coerce")
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / (avg_loss + 1e-12)
    return 100 - (100 / (1 + rs))


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high = pd.to_numeric(df["high"], errors="coerce")
    low = pd.to_numeric(df["low"], errors="coerce")
    close = pd.to_numeric(df["close"], errors="coerce")
    prev_close = close.shift(1)
    tr = pd.concat([(high - low).abs(), (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def _max_drawdown(equity: pd.Series) -> float:
    if equity.empty:
        return 0.0
    peak = equity.cummax()
    dd = equity / peak - 1.0
    return float(dd.min() * 100)


def _profit_factor(trade_pnls: List[float]) -> float:
    gains = sum(x for x in trade_pnls if x > 0)
    losses = abs(sum(x for x in trade_pnls if x < 0))
    if losses <= 1e-12:
        return float("inf") if gains > 0 else 0.0
    return gains / losses


def _annualization(interval: str) -> float:
    return {
        "1m": 365 * 24 * 60,
        "3m": 365 * 24 * 20,
        "5m": 365 * 24 * 12,
        "15m": 365 * 24 * 4,
        "30m": 365 * 24 * 2,
        "1h": 365 * 24,
        "4h": 365 * 6,
        "1d": 252,
        "1w": 52,
    }.get(str(interval), 252)


@dataclass
class BacktestConfig:
    strategy: str = "rsi"
    initial_cash: float = 10000.0
    fee_bps: float = 8.0
    slippage_bps: float = 3.0
    risk_per_trade_pct: float = 1.0
    max_position_pct: float = 95.0
    rsi_lower: float = 30.0
    rsi_upper: float = 70.0
    ema_fast: int = 20
    ema_slow: int = 50
    stop_atr: float = 2.0
    take_atr: float = 3.0


class BacktestEngine:
    """Vectorized educational backtester with run-card output and validation helpers."""

    def _prepare(self, data_df: pd.DataFrame) -> pd.DataFrame:
        if data_df is None or data_df.empty:
            raise ValueError("No market data supplied")
        df = data_df.copy()
        if "timestamp" not in df.columns:
            df["timestamp"] = pd.RangeIndex(len(df))
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
        for col in ["open", "high", "low", "close", "volume"]:
            if col not in df.columns:
                raise ValueError(f"Missing OHLCV column: {col}")
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["timestamp", "open", "high", "low", "close"]).sort_values("timestamp")
        if len(df) < 60:
            raise ValueError("At least 60 candles are required for a meaningful backtest")
        df = df.reset_index(drop=True)
        df["returns"] = df["close"].pct_change().fillna(0)
        df["rsi"] = _rsi(df["close"], 14)
        df["ema_fast"] = _ema(df["close"], 20)
        df["ema_slow"] = _ema(df["close"], 50)
        df["atr"] = _atr(df, 14)
        macd_fast = _ema(df["close"], 12)
        macd_slow = _ema(df["close"], 26)
        df["macd"] = macd_fast - macd_slow
        df["macd_signal"] = _ema(df["macd"], 9)
        df["macd_hist"] = df["macd"] - df["macd_signal"]
        return df

    def _signals(self, df: pd.DataFrame, cfg: BacktestConfig) -> pd.Series:
        strategy = (cfg.strategy or "rsi").lower()
        pos = pd.Series(0.0, index=df.index)
        if strategy in {"rsi", "rsi_reversion"}:
            in_pos = False
            for i, row in df.iterrows():
                r = _safe_float(row.get("rsi"), 50)
                if not in_pos and r <= cfg.rsi_lower:
                    in_pos = True
                elif in_pos and r >= cfg.rsi_upper:
                    in_pos = False
                pos.iloc[i] = 1.0 if in_pos else 0.0
        elif strategy in {"ema", "ema_cross", "trend"}:
            pos = (df["ema_fast"] > df["ema_slow"]).astype(float)
        elif strategy in {"macd", "momentum"}:
            pos = ((df["macd"] > df["macd_signal"]) & (df["macd_hist"] > 0)).astype(float)
        elif strategy in {"grid", "mean_reversion"}:
            ma = df["close"].rolling(24, min_periods=12).mean()
            sd = df["close"].rolling(24, min_periods=12).std()
            z = (df["close"] - ma) / (sd + 1e-12)
            in_pos = False
            for i, zi in enumerate(z.fillna(0)):
                if not in_pos and zi < -0.9:
                    in_pos = True
                elif in_pos and zi > 0.25:
                    in_pos = False
                pos.iloc[i] = 1.0 if in_pos else 0.0
        else:
            raise ValueError(f"Unsupported strategy: {cfg.strategy}")
        return pos.fillna(0).clip(0, 1)

    def run(self, data_df: pd.DataFrame, strategy: str = "rsi", config: Optional[Dict[str, Any]] = None, interval: str = "1h") -> Dict[str, Any]:
        cfg = BacktestConfig(strategy=strategy)
        if config:
            for key, value in config.items():
                if hasattr(cfg, key):
                    setattr(cfg, key, value)
        cfg.initial_cash = float(cfg.initial_cash or 10000)
        cfg.max_position_pct = min(100.0, max(0.0, float(cfg.max_position_pct)))
        fee = max(0.0, float(cfg.fee_bps) / 10000.0)
        slip = max(0.0, float(cfg.slippage_bps) / 10000.0)
        df = self._prepare(data_df)
        # Apply configured EMA periods after preparation.
        df["ema_fast"] = _ema(df["close"], int(cfg.ema_fast))
        df["ema_slow"] = _ema(df["close"], int(cfg.ema_slow))
        raw_pos = self._signals(df, cfg)
        # Execute on next candle to avoid look-ahead bias.
        position = raw_pos.shift(1).fillna(0) * (cfg.max_position_pct / 100.0)
        turnover = position.diff().abs().fillna(position.abs())
        gross = position * df["returns"]
        costs = turnover * (fee + slip)
        net = gross - costs
        equity = cfg.initial_cash * (1 + net).cumprod()
        bh_equity = cfg.initial_cash * (1 + df["returns"]).cumprod()

        # Trade approximation from position transitions.
        trade_pnls: List[float] = []
        entry_equity = None
        for i in range(len(position)):
            prev = position.iloc[i - 1] if i > 0 else 0
            cur = position.iloc[i]
            if cur > 0 and prev <= 0:
                entry_equity = equity.iloc[i]
            elif cur <= 0 and prev > 0 and entry_equity is not None:
                trade_pnls.append(float(equity.iloc[i] - entry_equity))
                entry_equity = None
        if entry_equity is not None:
            trade_pnls.append(float(equity.iloc[-1] - entry_equity))

        ann = _annualization(interval)
        ret = float(equity.iloc[-1] / cfg.initial_cash - 1)
        years = max(len(df) / ann, 1e-9)
        annualized = (1 + ret) ** (1 / years) - 1 if ret > -0.999 else -1
        vol = float(net.std(ddof=1) * math.sqrt(ann)) if len(net) > 2 else 0.0
        downside = net[net < 0].std(ddof=1) * math.sqrt(ann) if len(net[net < 0]) > 2 else 0.0
        sharpe = annualized / (vol + 1e-12)
        sortino = annualized / (float(downside) + 1e-12)
        wins = [x for x in trade_pnls if x > 0]

        records = []
        for idx, row in df.iterrows():
            records.append({
                "date": row["timestamp"].isoformat() if hasattr(row["timestamp"], "isoformat") else str(row["timestamp"]),
                "equity": round(float(equity.iloc[idx]), 2),
                "buy_hold": round(float(bh_equity.iloc[idx]), 2),
                "position": round(float(position.iloc[idx]), 3),
                "close": round(float(row["close"]), 6),
            })

        trades = len(trade_pnls)
        run_card = {
            "strategy": cfg.strategy,
            "created_at": datetime.utcnow().isoformat(),
            "candles": int(len(df)),
            "date_range": [records[0]["date"], records[-1]["date"]],
            "assumptions": {
                "execution_lag": "signals execute on next candle",
                "fees_bps": cfg.fee_bps,
                "slippage_bps": cfg.slippage_bps,
                "max_position_pct": cfg.max_position_pct,
                "no_leverage": True,
            },
            "warnings": [
                "Educational backtest; not financial advice.",
                "Historical performance does not guarantee future results.",
                "Provider data quality, slippage and liquidity can materially change live outcomes.",
            ],
        }

        return {
            "config": asdict(cfg),
            "run_card": run_card,
            "metrics": {
                "return_pct": round(ret * 100, 2),
                "annualized_return_pct": round(float(annualized) * 100, 2),
                "buy_hold_return_pct": round((float(bh_equity.iloc[-1]) / cfg.initial_cash - 1) * 100, 2),
                "final_value": round(float(equity.iloc[-1]), 2),
                "max_drawdown": round(_max_drawdown(equity), 2),
                "sharpe": round(float(sharpe), 3),
                "sortino": round(float(sortino), 3),
                "volatility_pct": round(vol * 100, 2),
                "trades": trades,
                "win_rate": round(len(wins) / trades * 100, 2) if trades else 0.0,
                "profit_factor": round(_profit_factor(trade_pnls), 3) if math.isfinite(_profit_factor(trade_pnls)) else 999.0,
                "exposure_pct": round(float((position > 0).mean()) * 100, 2),
                "total_cost_pct": round(float(costs.sum()) * 100, 3),
            },
            "equity_curve": records,
        }

    def walk_forward(self, data_df: pd.DataFrame, strategy: str = "rsi", config: Optional[Dict[str, Any]] = None, interval: str = "1h", folds: int = 4) -> Dict[str, Any]:
        df = self._prepare(data_df)
        folds = max(2, min(int(folds or 4), 8))
        if len(df) < folds * 80:
            folds = max(2, len(df) // 80)
        if folds < 2:
            raise ValueError("Not enough data for walk-forward validation")
        fold_size = len(df) // folds
        results = []
        for fold in range(1, folds):
            start = fold * fold_size
            end = (fold + 1) * fold_size if fold < folds - 1 else len(df)
            test = df.iloc[start:end].copy()
            if len(test) < 60:
                continue
            res = self.run(test, strategy=strategy, config=config, interval=interval)
            results.append({"fold": fold, "start": str(test["timestamp"].iloc[0]), "end": str(test["timestamp"].iloc[-1]), **res["metrics"]})
        avg_return = float(np.mean([r["return_pct"] for r in results])) if results else 0.0
        pass_rate = float(np.mean([1 if r["return_pct"] > 0 and r["max_drawdown"] > -35 else 0 for r in results]) * 100) if results else 0.0
        return {
            "strategy": strategy,
            "folds": results,
            "summary": {
                "avg_return_pct": round(avg_return, 2),
                "pass_rate_pct": round(pass_rate, 1),
                "fold_count": len(results),
                "interpretation": "Stable" if pass_rate >= 70 else "Mixed" if pass_rate >= 40 else "Weak",
            },
        }
