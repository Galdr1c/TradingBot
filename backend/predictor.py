import torch
import pandas as pd
import numpy as np
from datetime import datetime, timedelta

class KronosPredictor:
    """
    Kronos Foundation Model predictor.
    Uses NeoQuasar/Kronos-small from HuggingFace when available,
    falls back to a statistically informed simulation (GARCH-style).
    """
    def __init__(self, model_name="NeoQuasar/Kronos-small"):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model_name = model_name
        self.model = None
        self.tokenizer = None
        self.ready = False
        self._try_load()

    def _try_load(self):
        try:
            from model import Kronos, KronosTokenizer, KronosPredictor as _KP
            self.tokenizer = KronosTokenizer.from_pretrained("NeoQuasar/Kronos-Tokenizer-base")
            self.model = Kronos.from_pretrained(self.model_name)
            self.model = self.model.to(self.device)
            self._inner = _KP(self.model, self.tokenizer, max_context=512)
            self.ready = True
            print(f"[Kronos] Model loaded: {self.model_name} on {self.device}")
        except Exception as e:
            print(f"[Kronos] Full model unavailable ({e}), using statistical predictor")
            self.ready = True  # statistical mode is always ready

    def predict(self, df: pd.DataFrame, pred_len: int = 24) -> list:
        """
        Returns list of {t, p, hi, lo, timestamp} forecast points.
        If Kronos model is loaded, uses it. Otherwise uses GARCH-style simulation.
        """
        required = ['open', 'high', 'low', 'close']
        for col in required:
            if col not in df.columns:
                df[col] = df.get('close', pd.Series([0]*len(df)))

        if self.model is not None and hasattr(self, '_inner'):
            return self._kronos_predict(df, pred_len)
        else:
            return self._statistical_predict(df, pred_len)

    def _kronos_predict(self, df: pd.DataFrame, pred_len: int) -> list:
        """Use actual Kronos model."""
        try:
            lookback = min(400, len(df))
            x_df = df.iloc[-lookback:][['open','high','low','close','volume'] if 'volume' in df.columns else ['open','high','low','close']].copy()
            
            # Create timestamps
            if 'timestamp' in df.columns:
                last_ts = pd.to_datetime(df['timestamp'].iloc[-1])
            else:
                last_ts = datetime.now()
            
            x_timestamp = pd.Series(pd.date_range(end=last_ts, periods=len(x_df), freq='1h'))
            y_timestamp = pd.Series(pd.date_range(start=last_ts + timedelta(hours=1), periods=pred_len, freq='1h'))
            
            pred_df = self._inner.predict(df=x_df, x_timestamp=x_timestamp, y_timestamp=y_timestamp, pred_len=pred_len, T=0.7, top_p=0.9, sample_count=1)
            
            results = []
            for i, (_, row) in enumerate(pred_df.iterrows()):
                price = float(row.get('close', row.get('p', 0)))
                hi = float(row.get('high', price * 1.01))
                lo = float(row.get('low', price * 0.99))
                results.append({"t": i, "p": price, "hi": hi, "lo": lo, "timestamp": y_timestamp.iloc[i].isoformat()})
            return results
        except Exception as e:
            print(f"[Kronos] Inference error: {e}, falling back to statistical")
            return self._statistical_predict(df, pred_len)

    def _statistical_predict(self, df: pd.DataFrame, pred_len: int) -> list:
        """
        Advanced statistical prediction using:
        - GARCH-style volatility estimation
        - Trend detection via linear regression
        - Mean reversion component
        - Confidence intervals
        """
        prices = df['close'].dropna().values
        if len(prices) < 10:
            return [{"t": i, "p": float(prices[-1] if len(prices) > 0 else 0), "hi": 0, "lo": 0} for i in range(pred_len)]

        # Compute returns and volatility
        returns = np.diff(np.log(prices + 1e-10))
        mu = np.mean(returns[-50:]) if len(returns) >= 50 else np.mean(returns)
        
        # GARCH-style volatility (exponential weighted)
        lambda_decay = 0.94
        weights = np.array([lambda_decay**i for i in range(min(50, len(returns)))])[::-1]
        weights /= weights.sum()
        sigma2 = np.sum(weights[:len(returns[-50:])] * returns[-len(weights):]**2) if len(returns) >= len(weights) else np.var(returns)
        sigma = np.sqrt(max(sigma2, 1e-8))

        # Trend detection (last 20 bars linear regression)
        lookback = min(20, len(prices))
        x = np.arange(lookback)
        y = prices[-lookback:]
        slope = np.polyfit(x, y, 1)[0]
        trend_momentum = slope / (prices[-1] + 1e-10)

        # Mean reversion: detect if far from rolling mean
        rolling_mean = np.mean(prices[-20:])
        deviation = (prices[-1] - rolling_mean) / (rolling_mean + 1e-10)
        reversion_force = -deviation * 0.05

        last_price = float(prices[-1])
        forecast = []

        # Generate timestamps
        if 'timestamp' in df.columns:
            last_ts = pd.to_datetime(df['timestamp'].iloc[-1])
        else:
            last_ts = datetime.now()

        for i in range(pred_len):
            # Drift with trend + reversion
            drift = mu + trend_momentum * 0.3 + reversion_force * 0.2
            
            # Volatility shrinks over time (uncertainty increases)
            vol_scale = sigma * (1 + i * 0.05)
            
            noise = np.random.normal(drift, vol_scale)
            last_price *= np.exp(noise)
            
            # Confidence interval grows with horizon
            std_factor = sigma * np.sqrt(i + 1) * last_price
            hi = last_price + 1.96 * std_factor
            lo = last_price - 1.96 * std_factor

            ts = (last_ts + timedelta(hours=i+1)).isoformat()
            forecast.append({
                "t": i,
                "p": float(last_price),
                "hi": float(hi),
                "lo": float(lo),
                "timestamp": ts
            })

        return forecast
