import asyncio
import logging
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Tuple

import numpy as np
import pandas as pd

try:
    import ccxt.async_support as ccxt
except Exception:  # pragma: no cover - handled at runtime on user machine
    ccxt = None

try:
    import yfinance as yf
except Exception:  # pragma: no cover
    yf = None

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DataManager")


class DataManager:
    """Source-aware OHLCV loader with SQLite WAL cache, concurrency locks and safe fallbacks.

    Design goals:
    - Crypto pairs use Binance first, then Yahoo Finance, then cache, then demo fallback.
    - Equities/ETFs use Yahoo Finance first, then cache, then demo fallback.
    - API endpoints should not randomly 500 because of a locked SQLite database or provider outage.
    - Returned frames always have a consistent OHLCV schema plus `source`, `symbol`, `interval`.
    """

    VALID_BINANCE_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}

    def __init__(self, db_path="market_data.db"):
        self.db_path = db_path
        self._cache_lock = asyncio.Lock()
        self._fetch_locks = defaultdict(asyncio.Lock)
        self.binance = None
        if ccxt is not None:
            self.binance = ccxt.binance({"enableRateLimit": True, "options": {"defaultType": "spot"}})
        self._init_db()

    # ── SQLite cache ──────────────────────────────────────────────────────

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=30, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=30000")
        return conn

    def _init_db(self):
        conn = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS ohlcv (
                    symbol TEXT,
                    timestamp TEXT,
                    open REAL,
                    high REAL,
                    low REAL,
                    close REAL,
                    volume REAL,
                    source TEXT DEFAULT 'unknown',
                    interval TEXT DEFAULT '1h',
                    PRIMARY KEY (symbol, timestamp, interval)
                )
                """
            )
            cur.execute("PRAGMA table_info(ohlcv)")
            columns = {row[1] for row in cur.fetchall()}
            if "source" not in columns:
                cur.execute("ALTER TABLE ohlcv ADD COLUMN source TEXT DEFAULT 'unknown'")
            if "interval" not in columns:
                cur.execute("ALTER TABLE ohlcv ADD COLUMN interval TEXT DEFAULT '1h'")
            cur.execute("UPDATE ohlcv SET interval = COALESCE(NULLIF(interval, ''), '1h')")
            cur.execute("UPDATE ohlcv SET source = COALESCE(NULLIF(source, ''), 'legacy')")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_ohlcv_symbol_interval_time ON ohlcv(symbol, interval, timestamp)")
            conn.commit()
        finally:
            conn.close()

    # ── Normalization helpers ─────────────────────────────────────────────

    def _normalize_interval(self, interval: str) -> str:
        interval = str(interval or "1h").strip()
        if interval.isdigit():
            return f"{interval}m"
        lower = interval.lower()
        return "1M" if interval == "1M" else lower

    def _normalize_symbol(self, symbol: str) -> str:
        s = str(symbol or "BTC/USDT").strip().upper().replace("_", "/")
        aliases = {"BTC/USD": "BTC/USDT", "ETH/USD": "ETH/USDT"}
        return aliases.get(s, s)

    def _is_crypto_symbol(self, symbol: str) -> bool:
        return "/" in symbol

    def _to_yfinance_symbol(self, symbol: str) -> str:
        if "/" not in symbol:
            return symbol
        base, quote = symbol.split("/", 1)
        quote = "USD" if quote.upper() in {"USDT", "USDC", "BUSD", "USD"} else quote.upper()
        return f"{base}-{quote}"

    def _yfinance_interval_and_period(self, interval: str) -> Tuple[str, str]:
        # Yahoo Finance limits intraday history; 4h is built from 1h bars.
        mapping = {
            "1m": ("1m", "7d"),
            "3m": ("2m", "30d"),
            "5m": ("5m", "60d"),
            "15m": ("15m", "60d"),
            "30m": ("30m", "60d"),
            "1h": ("1h", "730d"),
            "4h": ("1h", "730d"),
            "1d": ("1d", "5y"),
            "1w": ("1wk", "10y"),
        }
        return mapping.get(interval, ("1h", "730d"))

    # ── Public API ────────────────────────────────────────────────────────

    async def get_ohlcv(self, symbol: str, interval: str = "1h", limit: int = 100) -> pd.DataFrame:
        interval = self._normalize_interval(interval)
        symbol = self._normalize_symbol(symbol)
        limit = max(2, min(int(limit or 100), 1500))
        key = f"{symbol}:{interval}:{limit}"

        async with self._fetch_locks[key]:
            cached = await self._get_from_cache(symbol, interval, limit)
            if self._is_cache_usable(cached, interval, limit):
                return cached.tail(limit)

            provider_errors = []
            fresh = pd.DataFrame()

            if self._is_crypto_symbol(symbol):
                try:
                    fresh = await self._fetch_binance(symbol, interval, limit)
                except Exception as exc:
                    provider_errors.append(f"binance: {exc}")
                    logger.warning("Binance fetch failed for %s %s: %s", symbol, interval, exc)
                if fresh.empty:
                    try:
                        fresh = await asyncio.to_thread(self._fetch_yfinance, symbol, interval, limit)
                    except Exception as exc:
                        provider_errors.append(f"yfinance: {exc}")
                        logger.warning("yfinance fallback failed for %s %s: %s", symbol, interval, exc)
            else:
                try:
                    fresh = await asyncio.to_thread(self._fetch_yfinance, symbol, interval, limit)
                except Exception as exc:
                    provider_errors.append(f"yfinance: {exc}")
                    logger.warning("yfinance fetch failed for %s %s: %s", symbol, interval, exc)

            if fresh is not None and not fresh.empty:
                await self._save_to_cache(fresh)
                return fresh.tail(limit)

            if cached is not None and not cached.empty:
                logger.warning("Using stale cache for %s %s after provider errors: %s", symbol, interval, "; ".join(provider_errors))
                cached = cached.copy()
                cached["source"] = cached.get("source", "cache").fillna("cache-stale").astype(str) + "-stale"
                return cached.tail(limit)

            logger.warning("Using demo OHLCV for %s %s after provider errors: %s", symbol, interval, "; ".join(provider_errors))
            return self._generate_demo_ohlcv(symbol, interval, limit)

    # ── Providers ─────────────────────────────────────────────────────────

    async def _fetch_binance(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        if self.binance is None:
            raise RuntimeError("ccxt is not installed")
        if interval not in self.VALID_BINANCE_INTERVALS:
            raise ValueError(f"unsupported Binance interval {interval}")
        ohlcv = await self.binance.fetch_ohlcv(symbol, timeframe=interval, limit=min(limit, 1000))
        if not ohlcv:
            raise ValueError("empty Binance response")
        df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True).dt.tz_convert(None)
        return self._finalize_ohlcv(df, symbol, interval, "binance", limit)

    def _fetch_yfinance(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        if yf is None:
            raise RuntimeError("yfinance is not installed")
        yf_symbol = self._to_yfinance_symbol(symbol)
        yf_interval, period = self._yfinance_interval_and_period(interval)
        ticker = yf.Ticker(yf_symbol)
        df = ticker.history(period=period, interval=yf_interval, auto_adjust=False, actions=False, repair=True, timeout=20)
        if df is None or df.empty:
            raise ValueError(f"empty response for {yf_symbol}")

        df = df.reset_index()
        time_col = "Datetime" if "Datetime" in df.columns else "Date"
        df = df.rename(columns={time_col: "timestamp", "Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
        df = df[["timestamp", "open", "high", "low", "close", "volume"]].copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True, errors="coerce").dt.tz_convert(None)

        if interval == "4h":
            df = (
                df.dropna(subset=["timestamp"]).set_index("timestamp")
                .resample("4h")
                .agg({"open": "first", "high": "max", "low": "min", "close": "last", "volume": "sum"})
                .dropna()
                .reset_index()
            )

        return self._finalize_ohlcv(df, symbol, interval, "yfinance", limit)

    # ── Transform/cache helpers ───────────────────────────────────────────

    def _interval_max_age(self, interval: str) -> timedelta:
        mapping = {
            "1m": timedelta(minutes=10), "3m": timedelta(minutes=20), "5m": timedelta(minutes=30),
            "15m": timedelta(hours=2), "30m": timedelta(hours=4), "1h": timedelta(hours=8),
            "4h": timedelta(hours=24), "1d": timedelta(days=5), "1w": timedelta(days=14),
        }
        return mapping.get(interval, timedelta(hours=12))

    def _is_cache_usable(self, df: pd.DataFrame, interval: str, limit: int) -> bool:
        if df is None or df.empty:
            return False
        if len(df) < max(20, min(limit, 60)):
            return False
        ts = pd.to_datetime(df["timestamp"].iloc[-1], errors="coerce")
        if pd.isna(ts):
            return False
        # Equities daily bars may not update during weekends/holidays; keep a generous daily TTL.
        return datetime.utcnow() - ts.to_pydatetime().replace(tzinfo=None) <= self._interval_max_age(interval)

    def _finalize_ohlcv(self, df: pd.DataFrame, symbol: str, interval: str, source: str, limit: int) -> pd.DataFrame:
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["timestamp", "open", "high", "low", "close"])
        df["volume"] = df["volume"].fillna(0)
        df = df[(df["high"] >= df[["open", "close", "low"]].max(axis=1)) | (df["high"] > 0)]
        df = df.sort_values("timestamp").drop_duplicates("timestamp", keep="last").tail(limit)
        df["source"] = source
        df["symbol"] = symbol
        df["interval"] = interval
        return df[["timestamp", "open", "high", "low", "close", "volume", "source", "symbol", "interval"]]

    async def _save_to_cache(self, df: pd.DataFrame):
        if df is None or df.empty:
            return
        records = []
        for row in df.itertuples(index=False):
            records.append((row.symbol, pd.to_datetime(row.timestamp).isoformat(), float(row.open), float(row.high), float(row.low), float(row.close), float(row.volume), str(row.source), str(row.interval)))
        async with self._cache_lock:
            conn = self._connect()
            try:
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

    async def _get_from_cache(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        async with self._cache_lock:
            conn = self._connect()
            try:
                query = """
                    SELECT symbol, timestamp, open, high, low, close, volume,
                           COALESCE(source, 'cache') AS source,
                           COALESCE(interval, ?) AS interval
                    FROM ohlcv
                    WHERE symbol = ? AND COALESCE(interval, ?) = ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                """
                df = pd.read_sql(query, conn, params=(interval, symbol, interval, interval, int(limit)))
            except Exception as exc:
                logger.warning("Cache read skipped for %s %s: %s", symbol, interval, exc)
                return pd.DataFrame()
            finally:
                conn.close()
        if df.empty:
            return pd.DataFrame()
        return self._finalize_ohlcv(df.sort_values("timestamp"), symbol, interval, "cache", limit)

    def _generate_demo_ohlcv(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        seed = abs(hash(f"{symbol}:{interval}")) % (2**32)
        rng = np.random.default_rng(seed)
        base_prices = {"BTC/USDT": 80000, "ETH/USDT": 3200, "SOL/USDT": 150, "BNB/USDT": 650, "AAPL": 220, "NVDA": 900, "TSLA": 240, "MSFT": 420}
        base = float(base_prices.get(symbol, 100))
        freq = {"1m": "1min", "3m": "3min", "5m": "5min", "15m": "15min", "30m": "30min", "1h": "1h", "4h": "4h", "1d": "1D"}.get(interval, "1h")
        end = pd.Timestamp.utcnow().floor("min").tz_localize(None)
        timestamps = pd.date_range(end=end, periods=limit, freq=freq)
        returns = rng.normal(0, 0.006 if self._is_crypto_symbol(symbol) else 0.003, size=limit)
        close = base * np.exp(np.cumsum(returns))
        open_ = np.r_[close[0], close[:-1]]
        spread = np.maximum(close * rng.uniform(0.0008, 0.007, size=limit), 0.01)
        high = np.maximum(open_, close) + spread
        low = np.maximum(0.01, np.minimum(open_, close) - spread)
        volume = rng.uniform(100, 5000, size=limit) * (10 if self._is_crypto_symbol(symbol) else 1000)
        df = pd.DataFrame({"timestamp": timestamps, "open": open_, "high": high, "low": low, "close": close, "volume": volume})
        return self._finalize_ohlcv(df, symbol, interval, "demo", limit)

    async def close(self):
        if self.binance is not None:
            await self.binance.close()
