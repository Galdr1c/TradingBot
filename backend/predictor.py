import logging
import os
from typing import List

import numpy as np
import pandas as pd
import torch

logger = logging.getLogger("KronosPredictor")


class KronosPredictor:
    """Kronos forecast wrapper with no fabricated/random output.

    If a real Kronos implementation is not installed, the endpoint returns a
    deterministic statistical estimate from the live OHLCV frame and labels the
    model mode honestly. It never generates random demo prices.
    """

    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model_name = os.getenv("KRONOS_MODEL", "NeoQuasar/Kronos-small")
        self.model = None
        self.tokenizer = None
        self.mode = "statistical_live_ohlcv"
        self.is_ready = self._load_model()

    def _load_model(self) -> bool:
        try:
            # Optional real Kronos adapter. The public project/API may vary, so
            # this block intentionally does not fake a successful load.
            from kronos import Kronos, KronosTokenizer  # type: ignore

            self.tokenizer = KronosTokenizer.from_pretrained(os.getenv("KRONOS_TOKENIZER", "NeoQuasar/Kronos-Tokenizer-base"))
            self.model = Kronos.from_pretrained(self.model_name).to(self.device)
            self.model.eval()
            self.mode = "kronos"
            logger.info("Kronos model loaded: %s on %s", self.model_name, self.device)
            return True
        except Exception as exc:
            logger.warning("Real Kronos package/model unavailable; using deterministic statistical forecast: %s", exc)
            return False

    def predict(self, df: pd.DataFrame, steps: int = 5) -> List[float]:
        if df is None or df.empty or "close" not in df.columns:
            raise ValueError("Live OHLCV data is required for prediction")
        steps = max(1, min(int(steps or 5), 240))

        if self.is_ready and self.model is not None and self.tokenizer is not None:
            try:
                data = df[["open", "high", "low", "close", "volume"]].tail(512).astype(float).values
                # The exact Kronos inference API can differ by package version;
                # fail closed into the deterministic estimator on API mismatch.
                tokens = self.tokenizer.encode(data)
                with torch.no_grad():
                    output = self.model.generate(tokens, max_new_tokens=steps)
                preds = self.tokenizer.decode(output)
                closes = np.asarray(preds)
                if closes.ndim > 1:
                    closes = closes[:, 3]
                result = [float(x) for x in closes[:steps]]
                if len(result) == steps:
                    return result
            except Exception as exc:
                logger.error("Kronos inference failed; using deterministic estimator: %s", exc)

        return self._deterministic_statistical_forecast(df, steps)

    def _deterministic_statistical_forecast(self, df: pd.DataFrame, steps: int) -> List[float]:
        close = pd.to_numeric(df["close"], errors="coerce").dropna().astype(float)
        if len(close) < 20:
            raise ValueError("At least 20 live candles are required for statistical forecast")

        returns = close.pct_change().dropna()
        # Robust drift: blend short EMA slope and median return; clamp outliers.
        ema_fast = close.ewm(span=12, adjust=False).mean()
        ema_slow = close.ewm(span=26, adjust=False).mean()
        trend = ((ema_fast.iloc[-1] - ema_slow.iloc[-1]) / max(close.iloc[-1], 1e-12)) / 12
        drift = float(np.nanmedian(returns.tail(60))) if len(returns) else 0.0
        drift = float(np.clip(0.55 * drift + 0.45 * trend, -0.025, 0.025))

        last = float(close.iloc[-1])
        preds = []
        for _ in range(steps):
            last = max(0.00000001, last * (1 + drift))
            preds.append(float(last))
        return preds
