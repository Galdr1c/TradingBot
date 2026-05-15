import asyncio
import logging
import os
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Tuple, Dict, Any

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


class LiveDataUnavailable(RuntimeError):
    """Raised when a live/real provider cannot return valid market data."""


class DataManager:
    """Live-only OHLCV/quote loader.

    The app must never fabricate candles, prices, portfolio values or P&L. This
    manager therefore tries real providers first and fails closed if they are not
    available. SQLite is used only as a real-data cache for diagnostics or for an
    opt-in recovery mode; it is not a mock/demo generator.
    """

    VALID_BINANCE_INTERVALS = {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M"}

    def __init__(self, db_path="market_data.db"):
        self.db_path = db_path
        self._cache_lock = asyncio.Lock()
        self._fetch_locks = defaultdict(asyncio.Lock)
        self.allow_cache_recovery = os.getenv("ALLOW_REAL_CACHE_FALLBACK", "false").lower() in {"1", "true", "yes", "on"}
        self.binance = None
        if ccxt is not None:
            self.binance = ccxt.binance({"enableRateLimit": True, "options": {"defaultType": "spot"}})
        self._init_db()

    # ── SQLite real-data cache ─────────────────────────────────────────────

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
        aliases = {"BTC/USD": "BTC/USDT", "ETH/USD": "ETH/USDT", "XBT/USDT": "BTC/USDT"}
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
        # Yahoo Finance has strict intraday limits; 4h is reconstructed from real 1h bars.
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
        """Return real provider candles only; never generated/demo data."""
        interval = self._normalize_interval(interval)
        symbol = self._normalize_symbol(symbol)
        limit = max(2, min(int(limit or 100), 1500))
        key = f"{symbol}:{interval}:{limit}"

        async with self._fetch_locks[key]:
            provider_errors = []
            fresh = pd.DataFrame()

            if self._is_crypto_symbol(symbol):
                try:
                    fresh = await self._fetch_binance(symbol, interval, limit)
                except Exception as exc:
                    provider_errors.append(f"binance: {exc}")
                    logger.warning("Binance fetch failed for %s %s: %s", symbol, interval, exc)
                # Real secondary provider only; still not demo data.
                if fresh.empty:
                    try:
                        fresh = await asyncio.to_thread(self._fetch_yfinance, symbol, interval, limit)
                    except Exception as exc:
                        provider_errors.append(f"yfinance: {exc}")
                        logger.warning("yfinance fetch failed for %s %s: %s", symbol, interval, exc)
            else:
                try:
                    fresh = await asyncio.to_thread(self._fetch_yfinance, symbol, interval, limit)
                except Exception as exc:
                    provider_errors.append(f"yfinance: {exc}")
                    logger.warning("yfinance fetch failed for %s %s: %s", symbol, interval, exc)

            if fresh is not None and not fresh.empty:
                await self._save_to_cache(fresh)
                return fresh.tail(limit)

            if self.allow_cache_recovery:
                cached = await self._get_from_cache(symbol, interval, limit)
                if cached is not None and not cached.empty:
                    cached = cached.copy()
                    cached["source"] = cached.get("source", "real-cache").fillna("real-cache").astype(str) + "-cache-recovery"
                    cached["live"] = False
                    return cached.tail(limit)

            raise LiveDataUnavailable(f"Live market data unavailable for {symbol} {interval}: {'; '.join(provider_errors) or 'no provider returned data'}")

    async def get_quote(self, symbol: str) -> Dict[str, Any]:
        """Return a real current quote/ticker snapshot; never fabricated values."""
        symbol = self._normalize_symbol(symbol)
        if self._is_crypto_symbol(symbol):
            try:
                return await self._fetch_binance_quote(symbol)
            except Exception as exc:
                logger.warning("Binance quote failed for %s: %s", symbol, exc)
                # yfinance crypto quote is a real public source, but often delayed.
                return await asyncio.to_thread(self._fetch_yfinance_quote, symbol)
        return await asyncio.to_thread(self._fetch_yfinance_quote, symbol)

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
        return self._finalize_ohlcv(df, symbol, interval, "binance", limit, live=True)

    async def _fetch_binance_quote(self, symbol: str) -> Dict[str, Any]:
        if self.binance is None:
            raise RuntimeError("ccxt is not installed")
        t = await self.binance.fetch_ticker(symbol)
        last = t.get("last") or t.get("close")
        prev = t.get("previousClose") or t.get("open")
        if last is None:
            raise ValueError("empty Binance ticker")
        change = None
        if prev not in (None, 0):
            change = (float(last) - float(prev)) / float(prev) * 100
        if t.get("percentage") is not None:
            change = float(t.get("percentage"))
        return {
            "symbol": symbol,
            "price": round(float(last), 8),
            "change": round(float(change or 0), 4),
            "volume": round(float(t.get("baseVolume") or t.get("quoteVolume") or 0), 4),
            "high24h": round(float(t.get("high") or last), 8),
            "low24h": round(float(t.get("low") or last), 8),
            "category": "crypto",
            "source": "binance",
            "live": True,
            "timestamp": datetime.utcnow().isoformat(),
        }

    def _fetch_yfinance(self, symbol: str, interval: str, limit: int) -> pd.DataFrame:
        if yf is None:
            raise RuntimeError("yfinance is not installed")
        yf_symbol = self._to_yfinance_symbol(symbol)
        yf_interval, period = self._yfinance_interval_and_period(interval)
        ticker = yf.Ticker(yf_symbol)
        df = ticker.history(period=period, interval=yf_interval, auto_adjust=False, actions=False, repair=True, timeout=20, raise_errors=True)
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

        return self._finalize_ohlcv(df, symbol, interval, "yfinance", limit, live=True)

    def _fetch_yfinance_quote(self, symbol: str) -> Dict[str, Any]:
        if yf is None:
            raise RuntimeError("yfinance is not installed")
        yf_symbol = self._to_yfinance_symbol(symbol)
        ticker = yf.Ticker(yf_symbol)
        fast = {}
        try:
            fast_obj = ticker.fast_info
            fast = dict(fast_obj) if fast_obj is not None else {}
        except Exception:
            fast = {}

        last = fast.get("last_price") or fast.get("regular_market_price")
        prev = fast.get("previous_close") or fast.get("regular_market_previous_close")
        high = fast.get("day_high")
        low = fast.get("day_low")
        volume = fast.get("last_volume") or fast.get("ten_day_average_volume") or 0

        if last is None:
            hist = ticker.history(period="5d", interval="1d", auto_adjust=False, actions=False, repair=True, timeout=20, raise_errors=True)
            if hist is None or hist.empty:
                raise ValueError(f"empty quote response for {yf_symbol}")
            last = float(hist["Close"].iloc[-1])
            prev = float(hist["Close"].iloc[-2]) if len(hist) > 1 else last
            high = float(hist["High"].iloc[-1])
            low = float(hist["Low"].iloc[-1])
            volume = float(hist["Volume"].iloc[-1]) if "Volume" in hist.columns else 0

        prev = float(prev or last)
        last = float(last)
        change = ((last - prev) / prev * 100) if prev else 0.0
        return {
            "symbol": symbol,
            "price": round(last, 8),
            "change": round(float(change), 4),
            "volume": round(float(volume or 0), 4),
            "high24h": round(float(high or last), 8),
            "low24h": round(float(low or last), 8),
            "category": "crypto" if self._is_crypto_symbol(symbol) else "equity",
            "source": "yfinance",
            "live": True,
            "timestamp": datetime.utcnow().isoformat(),
        }

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
        return datetime.utcnow() - ts.to_pydatetime().replace(tzinfo=None) <= self._interval_max_age(interval)

    def _finalize_ohlcv(self, df: pd.DataFrame, symbol: str, interval: str, source: str, limit: int, live: bool = True) -> pd.DataFrame:
        df = df.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
        for col in ["open", "high", "low", "close", "volume"]:
            df[col] = pd.to_numeric(df[col], errors="coerce")
        df = df.dropna(subset=["timestamp", "open", "high", "low", "close"])
        df["volume"] = df["volume"].fillna(0)
        df = df[(df[["open", "high", "low", "close"]] > 0).all(axis=1)]
        df = df[df["high"] >= df[["open", "close", "low"]].max(axis=1)]
        df = df[df["low"] <= df[["open", "close", "high"]].min(axis=1)]
        df = df.sort_values("timestamp").drop_duplicates("timestamp", keep="last").tail(limit)
        if df.empty:
            raise ValueError(f"provider returned no valid OHLCV rows for {symbol}")
        df["source"] = source
        df["symbol"] = symbol
        df["interval"] = interval
        df["live"] = bool(live)
        return df[["timestamp", "open", "high", "low", "close", "volume", "source", "symbol", "interval", "live"]]

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
                           COALESCE(source, 'real-cache') AS source,
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
        return self._finalize_ohlcv(df.sort_values("timestamp"), symbol, interval, "real-cache", limit, live=False)

    async def close(self):
        if self.binance is not None:
            await self.binance.close()
