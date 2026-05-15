"""
OpenTrader Integration Bridge
Connects to the OpenTrader CLI (https://github.com/Open-Trader/opentrader)
for real GRID, DCA and RSI bot execution and backtesting. No local simulation fallback is used.

Usage:
  npm install -g opentrader
  opentrader set-password <password>
  # Then start your FastAPI — this bridge manages the subprocess.
"""
import asyncio
import subprocess
import json
import os
import logging
import httpx
from typing import Optional, Dict, Any, List
from datetime import datetime

logger = logging.getLogger("OpenTraderBridge")

OPENTRADER_PORT = int(os.getenv("OPENTRADER_PORT", "8001"))
OPENTRADER_PASSWORD = os.getenv("OPENTRADER_PASSWORD", "")
OPENTRADER_BASE = f"http://localhost:{OPENTRADER_PORT}"

# ── Process management ───────────────────────────────────────────────────────

_ot_process: Optional[subprocess.Popen] = None
_ot_available = False


async def start_opentrader() -> bool:
    """Start OpenTrader as a background process on OPENTRADER_PORT."""
    global _ot_process, _ot_available

    # Check if already running
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{OPENTRADER_BASE}/api/health")
            if r.status_code < 400:
                _ot_available = True
                logger.info("OpenTrader already running")
                return True
    except Exception:
        pass

    # Try to start it
    try:
        cmd = ["opentrader", "up", "--port", str(OPENTRADER_PORT)]
        _ot_process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        # Give it time to boot
        await asyncio.sleep(4)

        async with httpx.AsyncClient(timeout=5) as c:
            r = await c.get(f"{OPENTRADER_BASE}/api/health")
            _ot_available = r.status_code < 400
            if _ot_available:
                logger.info(f"OpenTrader started on port {OPENTRADER_PORT}")
            return _ot_available
    except FileNotFoundError:
        logger.warning("opentrader CLI not found. Install with: npm install -g opentrader")
        _ot_available = False
        return False
    except Exception as e:
        logger.error(f"Failed to start OpenTrader: {e}")
        _ot_available = False
        return False


def stop_opentrader():
    global _ot_process
    if _ot_process:
        _ot_process.terminate()
        _ot_process = None
    os.system("opentrader down 2>/dev/null")


def is_available() -> bool:
    return _ot_available


# ── REST API bridge ───────────────────────────────────────────────────────────

async def _get(path: str, params: dict = None) -> Optional[dict]:
    if not _ot_available:
        return None
    try:
        headers = {}
        if OPENTRADER_PASSWORD:
            headers["Authorization"] = f"Basic {OPENTRADER_PASSWORD}"
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{OPENTRADER_BASE}{path}", params=params, headers=headers)
            if r.status_code == 200:
                return r.json()
    except Exception as e:
        logger.error(f"OpenTrader GET {path}: {e}")
    return None


async def _post(path: str, body: dict = None) -> Optional[dict]:
    if not _ot_available:
        return None
    try:
        headers = {"Content-Type": "application/json"}
        if OPENTRADER_PASSWORD:
            headers["Authorization"] = f"Basic {OPENTRADER_PASSWORD}"
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{OPENTRADER_BASE}{path}", json=body or {}, headers=headers)
            if r.status_code < 300:
                return r.json()
    except Exception as e:
        logger.error(f"OpenTrader POST {path}: {e}")
    return None


# ── CLI-based backtesting (most reliable path) ────────────────────────────────

async def run_backtest_cli(
    strategy: str,          # "grid" | "dca" | "rsi"
    symbol: str,            # "BTC/USDT"
    timeframe: str,         # "1h"
    from_date: str,         # "2024-01-01"
    to_date: str,           # "2024-06-01"
    extra_args: list = None
) -> Dict[str, Any]:
    """
    Runs: opentrader backtest <strategy> --from <date> --to <date> -t <timeframe>
    Captures stdout and parses JSON results.
    """
    cmd = [
        "opentrader", "backtest", strategy,
        "--from", from_date,
        "--to", to_date,
        "-t", timeframe,
        "--pair", symbol,
        "--json",   # request JSON output (if supported by installed version)
    ]
    if extra_args:
        cmd.extend(extra_args)

    try:
        result = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            ),
            timeout=2,
        )
        stdout, stderr = await asyncio.wait_for(result.communicate(), timeout=120)
        output = stdout.decode()

        # Try to parse JSON from output
        try:
            data = json.loads(output)
            return {"source": "opentrader_cli", "strategy": strategy, **data}
        except json.JSONDecodeError:
            # Parse text output
            return _parse_cli_output(output, strategy, symbol)

    except FileNotFoundError:
        return {"error": "opentrader CLI not installed", "install": "npm install -g opentrader"}
    except asyncio.TimeoutError:
        return {"error": "Backtest timed out (>120s)"}
    except Exception as e:
        return {"error": str(e)}


def _parse_cli_output(text: str, strategy: str, symbol: str) -> dict:
    """Extract key metrics from OpenTrader CLI text output."""
    import re
    result = {
        "source": "opentrader_cli",
        "strategy": strategy,
        "symbol": symbol,
        "raw": text[:2000],
        "metrics": {}
    }
    # Common patterns in OpenTrader CLI output
    patterns = {
        "total_profit": r"Total Profit[:\s]+([+-]?\d+\.?\d*)",
        "profit_pct":   r"Profit[:\s]+([+-]?\d+\.?\d*)\s*%",
        "trades":       r"Total Trades[:\s]+(\d+)",
        "win_rate":     r"Win Rate[:\s]+(\d+\.?\d*)\s*%",
        "sharpe":       r"Sharpe[:\s]+([+-]?\d+\.?\d*)",
        "max_dd":       r"Max Drawdown[:\s]+([+-]?\d+\.?\d*)\s*%",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            try:
                result["metrics"][key] = float(m.group(1))
            except ValueError:
                pass
    return result


# ── High-level helpers used by main.py ────────────────────────────────────────

async def get_opentrader_status() -> dict:
    """Returns OpenTrader connection status and available strategies."""
    alive = False
    bots = []
    try:
        data = await _get("/api/bots")
        if data is not None:
            alive = True
            bots = data if isinstance(data, list) else []
    except Exception:
        pass

    return {
        "available": _ot_available,
        "connected": alive,
        "port": OPENTRADER_PORT,
        "base_url": OPENTRADER_BASE,
        "strategies": ["grid", "dca", "rsi"],
        "bots": bots,
        "install_hint": "npm install -g opentrader && opentrader set-password <pw> && opentrader up",
    }


async def run_opentrader_strategy(
    strategy: str,
    symbol: str,
    params: dict,
    paper: bool = True,
) -> dict:
    """Start a strategy through the real OpenTrader REST API only."""
    if not _ot_available:
        return {
            "ok": False,
            "source": "opentrader_unavailable",
            "error": "OpenTrader is not running. No simulated bot was started.",
            "install_hint": "npm install -g opentrader && opentrader set-password <pw> && opentrader up",
        }

    body = {
        "strategy": strategy,
        "pair": symbol,
        "settings": params,
        "paperTrading": paper,
    }
    result = await _post("/api/bots", body)
    if result:
        return {"ok": True, "source": "opentrader_api", "bot": result}
    return {"ok": False, "source": "opentrader_api", "error": "OpenTrader API did not return a bot payload"}


async def run_opentrader_backtest(
    strategy: str,
    symbol: str,
    timeframe: str,
    from_date: str,
    to_date: str,
    params: dict = None,
) -> dict:
    """Run OpenTrader CLI backtest only; no random/local simulation fallback."""
    result = await run_backtest_cli(strategy, symbol, timeframe, from_date, to_date)
    if "error" in result:
        return {
            "ok": False,
            "source": "opentrader_cli_unavailable",
            "error": result.get("error"),
            "install": result.get("install", "npm install -g opentrader"),
            "note": "No Python/random simulation fallback is used in live-data-only mode.",
        }
    result["ok"] = True
    return result
