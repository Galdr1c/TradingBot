import sqlite3
import pandas as pd
import ccxt.async_support as ccxt
import yfinance as yf
import asyncio
import logging
from typing import Tuple

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DataManager")


class DataManager:
    def __init__(self, db_path="market_data.db"):
        self.db_path = db_path
        self._init_db()
        self.binance = ccxt.binance({
            "enableRateLimit": True,
            "options": {"defaultType": "spot"},
        })

    def _init_db(self):
        """Initialize SQLite database for OHLCV caching."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute(
            """
            CREATE TABLE IF NOT EXISTS ohlcv (
                symbol TEXT,
                timestamp DATETIME,
                open REAL,
                high REAL,
                low REAL,
                close REAL,
                volume REAL,
                source TEXT,
                interval TEXT,
                PRIMARY KEY (symbol, timestamp, interval)
            )
            """
        )
        conn.commit()
        conn.close()

    def _normalize_interval(self, interval: str) -> str:
        """Normalize UI intervals into provider-compatible canonical intervals."""
        interval = str(interval or "1h").strip().lower()
        if interval.isdigit():
            return f"{interval}m"
        return interval

    def _normalize_symbol(self, symbol: str) -> str:
        """Normalize URL-safe symbols such as BTC_USDT into BTC/USDT."""
        return str(symbol or "BTC/USDT").strip().upper().replace("_", "/")

    def _is_crypto_symbol(self, symbol: str) -> bool:
        """Crypto pairs use slash notation in this project, e.g. BTC/USDT."""
        return "/" in symbol

    def _to_yfinance_symbol(self, symbol: str) -> str:
        """Convert app symbols to Yahoo Finance tickers.

        Examples:
        BTC/USDT -> BTC-USD
        ETH/USDC -> ETH-USD
        MSFT     -> MSFT
        """
        if "/" not in symbol:
            return symbol
        base, quote = symbol.split("/", 1)
        quote = quote.upper()
        if quote in {"USDT", "USDC", "BUSD", "USD"}:
            quote = "USD"
        return f"{base}-{quote}"

    def _yfinance_interval_and_period(self, interval: str) -> Tuple[str, str]:
        """Map project intervals to yfinance intervals and safe history periods."""
        mapping = {
            "1m": ("1m", "7d"),
            "5m": ("5m", "60d"),
            "15m": ("15m", "60d"),
            "1h": ("1h", "60d"),
            # yfinance does not reliably support 4h directly; fetch 1h then resample.
            "4h": ("1h", "90d"),
            "1d": ("1d", "2y"),
        }
        return mapping.get(interval, ("1h", "60d"))

    async def get_ohlcv(self, symbol: str, interval: str = "1h", limit: int = 100):
        """
        Get OHLCV data with source-aware fallback logic.

        Crypto pairs: cache -> Binance -> yfinance fallback
        Stocks/ETFs : cache -> yfinance

        This avoids noisy Binance errors for stock symbols such as AAPL/MSFT,
        while still keeping Binance as the primary provider for crypto pairs.
        """
        interval = self._normalize_interval(interval)
        symbol = self._normalize_symbol(symbol)
        limit = max(1, int(limit or 100))

        cached_data = self._get_from_cache(symbol, interval, limit)
        if not cached_data.empty and len(cached_data) >= limit:
            return cached_data

        if self._is_crypto_symbol(symbol):
            try:
                return await self._fetch_binance(symbol, interval, limit)
            except Exception as e:
                logger.warning(f"Binance fetch failed for {symbol}: {e}")

        try:
            return await asyncio.to_thread(self._fetch_yfinance, symbol, interval, limit)
        except Exception as e:
            logger.warning(f"yfinance fetch failed for {symbol}: {e}")

        return cached_data

    async def _fetch_binance(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        ohlcv = await self.binance.fetch_ohlcv(symbol, timeframe=interval, limit=limit)
        df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert(None)
        df["source"] = "binance"
        df["symbol"] = symbol
        df["interval"] = interval
        df = self._finalize_ohlcv(df, symbol, interval, "binance", limit)
        self._save_to_cache(df)
        return df

    def _fetch_yfinance(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        yf_symbol = self._to_yfinance_symbol(symbol)
        yf_interval, period = self._yfinance_interval_and_period(interval)

        ticker = yf.Ticker(yf_symbol)
        df = ticker.history(period=period, interval=yf_interval, auto_adjust=False, actions=False)
        if df is None or df.empty:
            raise ValueError(f"empty response for {yf_symbol}")

        df = df.reset_index()
        time_col = "Datetime" if "Datetime" in df.columns else "Date"
        df = df.rename(
            columns={
                time_col: "timestamp",
                "Open": "open",
                "High": "high",
                "Low": "low",
                "Close": "close",
                "Volume": "volume",
            }
        )

        df = df[["timestamp", "open", "high", "low", "close", "volume"]].copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True).dt.tz_convert(None)

        if interval == "4h":
            df = (
                df.set_index("timestamp")
                .resample("4h")
                .agg({
                    "open": "first",
                    "high": "max",
                    "low": "min",
                    "close": "last",
                    "volume": "sum",
                })
                .dropna()
                .reset_index()
            )

        df = self._finalize_ohlcv(df, symbol, interval, "yfinance", limit)
        self._save_to_cache(df)
        return df

    def _finalize_ohlcv(self, df: pd.DataFrame, symbol: str, interval: str, source: str, limit: int) -> pd.DataFrame:
        df = df.copy()
        df["source"] = source
        df["symbol"] = symbol
        df["interval"] = interval
        numeric_cols = ["open", "high", "low", "close", "volume"]
        for col in numeric_cols:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["timestamp", "open", "high", "low", "close"])
        df["volume"] = df["volume"].fillna(0)
        df = df.sort_values("timestamp").tail(limit)
        return df[["timestamp", "open", "high", "low", "close", "volume", "source", "symbol", "interval"]]

    def _save_to_cache(self, df: pd.DataFrame):
        if df is None or df.empty:
            return
        conn = sqlite3.connect(self.db_path)
        try:
            records = []
            for row in df.itertuples(index=False):
                ts = pd.to_datetime(row.timestamp).isoformat()
                records.append((row.symbol, ts, row.open, row.high, row.low, row.close, row.volume, row.source, row.interval))
            conn.executemany(
                """
                INSERT OR REPLACE INTO ohlcv
                (symbol, timestamp, open, high, low, close, volume, source, interval)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                records,
            )
            conn.commit()
        finally:
            conn.close()

    def _get_from_cache(self, symbol: str, interval: str, limit: int):
        conn = sqlite3.connect(self.db_path)
        try:
            query = "SELECT * FROM ohlcv WHERE symbol = ? AND interval = ? ORDER BY timestamp DESC LIMIT ?"
            df = pd.read_sql(query, conn, params=(symbol, interval, int(limit)))
        finally:
            conn.close()
        if not df.empty:
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            return df.sort_values("timestamp")
        return pd.DataFrame()

    async def close(self):
        await self.binance.close()
