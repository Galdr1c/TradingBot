import sqlite3
import pandas as pd
import ccxt.async_support as ccxt
import yfinance as yf
import asyncio
import os
from datetime import datetime, timedelta
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DataManager")

class DataManager:
    def __init__(self, db_path="market_data.db"):
        self.db_path = db_path
        self._init_db()
        self.binance = ccxt.binance({
            'enableRateLimit': True,
            'options': {'defaultType': 'spot'}
        })
        
    def _init_db(self):
        """Initialize SQLite database for OHLCV caching."""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute('''
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
        ''')
        conn.commit()
        conn.close()

    async def get_ohlcv(self, symbol: str, interval: str = '1h', limit: int = 100):
        """
        Get OHLCV data with fallback logic:
        1. Try local cache
        2. Try Binance (CCXT)
        3. Try yfinance (Fallback)
        """
        # 1. Try Cache first
        cached_data = self._get_from_cache(symbol, interval, limit)
        if not cached_data.empty and len(cached_data) >= limit:
            # Check if last record is fresh (e.g., within the last interval)
            # For simplicity in MVP, we return cache if enough, but in Prod we'd check TTL
            return cached_data

        # 2. Try Binance
        try:
            ohlcv = await self.binance.fetch_ohlcv(symbol, timeframe=interval, limit=limit)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df['source'] = 'binance'
            df['symbol'] = symbol
            df['interval'] = interval
            self._save_to_cache(df)
            return df
        except Exception as e:
            logger.error(f"Binance fetch failed for {symbol}: {e}")

        # 3. Try yfinance Fallback
        try:
            # Map CCXT symbol to yfinance (approximate)
            yf_sym = symbol.replace('/', '-')
            if '-' not in yf_sym and 'USDT' in yf_sym:
                yf_sym = yf_sym.replace('USDT', '-USD')
            
            ticker = yf.Ticker(yf_sym)
            # Map intervals
            yf_interval = '1h' if interval == '1h' else '1d' if interval == '1d' else '1m'
            df_yf = ticker.history(period='5d', interval=yf_interval).tail(limit)
            
            if not df_yf.empty:
                df_yf = df_yf.reset_index()
                df_yf = df_yf.rename(columns={
                    'Date': 'timestamp', 'Datetime': 'timestamp',
                    'Open': 'open', 'High': 'high', 'Low': 'low', 
                    'Close': 'close', 'Volume': 'volume'
                })
                df_yf['timestamp'] = pd.to_datetime(df_yf['timestamp'])
                df_yf['source'] = 'yfinance'
                df_yf['symbol'] = symbol
                df_yf['interval'] = interval
                # Normalize columns
                final_df = df_yf[['timestamp', 'open', 'high', 'low', 'close', 'volume', 'source', 'symbol', 'interval']]
                self._save_to_cache(final_df)
                return final_df
        except Exception as e:
            logger.error(f"yfinance fallback failed for {symbol}: {e}")

        return cached_data # Return whatever we have if all fails

    def _save_to_cache(self, df: pd.DataFrame):
        conn = sqlite3.connect(self.db_path)
        try:
            df.to_sql('ohlcv', conn, if_exists='append', index=False, method='multi')
        except sqlite3.IntegrityError:
            # Handle duplicates by ignoring or updating
            pass
        conn.close()

    def _get_from_cache(self, symbol: str, interval: str, limit: int):
        conn = sqlite3.connect(self.db_path)
        query = f"SELECT * FROM ohlcv WHERE symbol='{symbol}' AND interval='{interval}' ORDER BY timestamp DESC LIMIT {limit}"
        df = pd.read_sql(query, conn)
        conn.close()
        if not df.empty:
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            return df.sort_values('timestamp')
        return pd.DataFrame()

    async def close(self):
        await self.binance.close()
