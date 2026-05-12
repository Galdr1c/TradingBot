import backtrader as bt
import pandas as pd
from datetime import datetime

class QuantumStrategy(bt.Strategy):
    params = (('rsi_period', 14), ('rsi_upper', 70), ('rsi_lower', 30),)

    def __init__(self):
        self.rsi = bt.indicators.RSI(period=self.params.rsi_period)

    def next(self):
        if not self.position:
            if self.rsi < self.params.rsi_lower:
                self.buy()
        elif self.rsi > self.params.rsi_upper:
            self.close()

class EquityLogger(bt.Analyzer):
    def __init__(self):
        self.vals = []
    def next(self):
        self.vals.append({'date': self.strategy.datetime.datetime(0).strftime('%Y-%m-%d'), 'equity': self.strategy.broker.getvalue()})
    def get_analysis(self):
        return self.vals

class BacktestEngine:
    def __init__(self):
        self.cerebro = bt.Cerebro()
        self.cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe')
        self.cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
        self.cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
        self.cerebro.addanalyzer(EquityLogger, _name='equity')

    def run(self, data_df: pd.DataFrame, strategy=QuantumStrategy):
        # Clean up previous runs
        self.cerebro = bt.Cerebro()
        self.cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe')
        self.cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
        self.cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')
        self.cerebro.addanalyzer(EquityLogger, _name='equity')

        # Convert df to Backtrader Feed
        df_copy = data_df.copy()
        df_copy['timestamp'] = pd.to_datetime(df_copy['timestamp'])
        df_copy = df_copy.set_index('timestamp')
        
        feed = bt.feeds.PandasData(dataname=df_copy)
        self.cerebro.adddata(feed)
        self.cerebro.addstrategy(strategy)
        self.cerebro.broker.setcash(10000.0)
        
        results = self.cerebro.run()
        strat = results[0]
        
        return {
            "metrics": {
                "sharpe": round(strat.analyzers.sharpe.get_analysis().get('sharperatio', 0) or 0, 2),
                "max_drawdown": round(strat.analyzers.drawdown.get_analysis().get('max', {}).get('drawdown', 0), 2),
                "final_value": round(self.cerebro.broker.getvalue(), 2)
            },
            "equity_curve": strat.analyzers.equity.get_analysis()
        }
