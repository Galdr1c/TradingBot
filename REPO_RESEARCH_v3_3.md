# v3.3 Repository Research & Implemented Improvements

This release reviews ideas from four public repositories and implements compatible, original code inside QuantumAI TradingBot. No third-party repository source code was copied directly; features are re-created to fit this app's architecture.

## Reviewed repositories

- **HKUDS/Vibe-Trading** — multi-agent finance workspace, research/backtest run cards, validation workflow, correlation dashboard, MCP/tool based research flow, Shadow Account style trade review ideas.
- **Panniantong/Agent-Reach** — safe research scaffolding, source health checks, Jina/RSS/GitHub style adapters, optional social/web tools without forcing paid APIs.
- **shiyu-coder/Kronos** — K-line foundation model concepts, OHLCV input discipline, max-context awareness, forecast workflow and production caveats.
- **Open-Trader/opentrader** — GRID/DCA/RSI strategy flows, paper trading posture, exchange/strategy separation, UI monitoring patterns.

## Implemented in v3.3

### Backend

- `ResearchAdapter`: RSS market briefing, safe URL reader via Jina Reader style flow, public GitHub repository inspector, explicit source status endpoint.
- `CorrelationEngine`: cross-asset return correlation matrix and high-correlation pair detection.
- `RiskEngine`: ATR-based position sizing, stop-distance estimates, max allocation guardrail.
- `BacktestEngine`: dependency-light vectorized backtester with execution lag to reduce lookahead bias, fees/slippage assumptions, run card output, buy-and-hold benchmark, win rate, Sharpe, Sortino, max drawdown, profit factor and walk-forward validation.
- Multi-timeframe decision endpoint: combines 15m/1h/4h/1d signals and reduces confidence when timeframes conflict.

### Frontend

- New **Research** page: source status, market briefing, repository intelligence, safe URL reader.
- New **Risk Lab** page: correlation heatmap, ATR position sizing, advanced backtest, walk-forward validation.
- Charts page now shows multi-timeframe consensus cards.
- Settings/System stats now report the local research adapter state.

## Risk/accuracy notes

- The app is still a research and simulation tool; it does not guarantee profitable trades.
- Backtests now model transaction cost and slippage assumptions, but live trading has liquidity, latency, spread and execution risks.
- Multi-timeframe consensus can reduce noisy one-timeframe decisions, but it is not a substitute for risk management.
- Optional external research endpoints can fail because websites, feeds or GitHub rate limits may be unavailable; the UI handles that without crashing.
