import unittest
from python_server.engine import Engine
from python_server.market import MarketSim, UNIVERSE, HISTORY_LEN
from python_server.portfolio import Portfolio, START_CASH

class TestMarketAndPortfolio(unittest.TestCase):

    def test_candles_history(self):
        eng = Engine()
        sim = MarketSim(eng)
        for meta in UNIVERSE:
            candles = sim.candles(meta.symbol)
            # 480 historical candles + 1 forming live candle
            self.assertEqual(len(candles), HISTORY_LEN + 1)
            for c in candles:
                self.assertGreater(c['h'], 0)
                self.assertGreater(c['l'], 0)
                self.assertGreaterEqual(c['h'], c['l'])
                self.assertGreaterEqual(c['h'], c['o'])
                self.assertGreaterEqual(c['h'], c['c'])
                self.assertLessEqual(c['l'], c['o'])
                self.assertLessEqual(c['l'], c['c'])

    def test_market_trades_both_sides(self):
        eng = Engine()
        sim = MarketSim(eng)
        has_buy = False
        has_sell = False

        for _ in range(12):
            _, fills = sim.tick(250)
            for f in fills:
                if f['side'] == 'B':
                    has_buy = True
                if f['side'] == 'S':
                    has_sell = True
            if has_buy and has_sell:
                break

        self.assertTrue(has_buy, "Expected at least one buy trade")
        self.assertTrue(has_sell, "Expected at least one sell trade")

    def test_live_ticks_consistent(self):
        eng = Engine()
        sim = MarketSim(eng)
        snap1 = sim.snapshot('AAPL')
        self.assertIsNotNone(snap1)

        sim.tick(250)
        snap2 = sim.snapshot('AAPL')
        self.assertIsNotNone(snap2)
        c = snap2['candle']
        self.assertGreaterEqual(c['h'], c['l'])
        self.assertGreaterEqual(c['h'], c['c'])
        self.assertLessEqual(c['l'], c['c'])

    def test_portfolio_market_buy(self):
        eng = Engine()
        sim = MarketSim(eng)
        portfolio = Portfolio(eng)

        res = portfolio.place('AAPL', 'B', 'MARKET', 0, 10)
        self.assertGreater(len(res['fills']), 0)
        self.assertLess(portfolio.cash, START_CASH)

        pos = portfolio.positions.get('AAPL')
        self.assertIsNotNone(pos)
        self.assertEqual(pos.qty, 10)
        self.assertGreater(pos.avg, 0)

    def test_portfolio_sells_and_reject_oversell(self):
        eng = Engine()
        sim = MarketSim(eng)
        portfolio = Portfolio(eng)

        # Buy 10 first
        portfolio.place('AAPL', 'B', 'MARKET', 0, 10)

        # Attempt to sell 15 (should fail)
        with self.assertRaises(ValueError) as ctx:
            portfolio.place('AAPL', 'S', 'MARKET', 0, 15)
        self.assertIn('Not enough shares', str(ctx.exception))

        # Sell 10 (should succeed and realize P&L)
        res_sell = portfolio.place('AAPL', 'S', 'MARKET', 0, 10)
        self.assertGreater(len(res_sell['fills']), 0)
        pos = portfolio.positions.get('AAPL')
        self.assertEqual(pos.qty, 0)

    def test_portfolio_limit_buy_reservation(self):
        eng = Engine()
        sim = MarketSim(eng)
        portfolio = Portfolio(eng)

        # Place resting limit buy below market so it rests
        res = portfolio.place('AAPL', 'B', 'LIMIT', 50.0, 10)
        self.assertEqual(res['status'], 'OPEN')
        self.assertEqual(portfolio.reserved_cash(), 500.0)
        self.assertEqual(portfolio.available_cash(), START_CASH - 500.0)

        # Cancel order
        portfolio.cancel(res['id'])
        self.assertEqual(portfolio.reserved_cash(), 0.0)
        self.assertEqual(portfolio.available_cash(), START_CASH)

    def test_portfolio_insufficient_buying_power(self):
        eng = Engine()
        sim = MarketSim(eng)
        portfolio = Portfolio(eng)

        # Try to buy more than $100k
        with self.assertRaises(ValueError) as ctx:
            portfolio.place('AAPL', 'B', 'LIMIT', 500.0, 1000)
        self.assertIn('Insufficient buying power', str(ctx.exception))

    def test_portfolio_resting_orders_book_maker_fills(self):
        eng = Engine()
        sim = MarketSim(eng)
        portfolio = Portfolio(eng)

        snap = sim.snapshot('AAPL')
        current_px = snap['price']

        # Place a resting limit buy right near the mid
        res = portfolio.place('AAPL', 'B', 'LIMIT', round(current_px + 0.10, 2), 5)
        # If it filled immediately or partially, cash was debited
        self.assertLess(portfolio.cash, START_CASH)

if __name__ == '__main__':
    unittest.main()
