import unittest
from python_server.engine import Engine, Trie, CircularQueue

class TestEngine(unittest.TestCase):

    def test_price_priority(self):
        eng = Engine()
        eng.add_symbol('AAPL')

        # Resting asks: worse price ($102) placed first, better price ($100) placed second
        eng.place('AAPL', 'S', 'LIMIT', 102, 10)
        eng.place('AAPL', 'S', 'LIMIT', 100, 10)

        # Incoming buy for 10 @ $105 should match the better ask ($100)
        res_buy = eng.place('AAPL', 'B', 'LIMIT', 105, 10)
        self.assertEqual(len(res_buy['fills']), 1)
        self.assertEqual(res_buy['fills'][0].price, 100)

        # Resting bids: worse price ($98) placed first, better price ($100) placed second
        eng.place('AAPL', 'B', 'LIMIT', 98, 10)
        eng.place('AAPL', 'B', 'LIMIT', 100, 10)

        # Incoming sell for 10 @ $95 should match the better bid ($100)
        res_sell = eng.place('AAPL', 'S', 'LIMIT', 95, 10)
        self.assertEqual(len(res_sell['fills']), 1)
        self.assertEqual(res_sell['fills'][0].price, 100)

    def test_time_priority(self):
        eng = Engine()
        eng.add_symbol('AAPL')

        # Two sell orders at the same price ($100)
        o1 = eng.place('AAPL', 'S', 'LIMIT', 100, 10)
        o2 = eng.place('AAPL', 'S', 'LIMIT', 100, 10)

        # Incoming buy for 10 @ $100 fills exactly one resting order
        res = eng.place('AAPL', 'B', 'LIMIT', 100, 10)
        self.assertEqual(len(res['fills']), 1)

        # Verify O1 was consumed (not in index) and O2 remains resting in index
        self.assertNotIn(o1['id'], eng.index)
        self.assertIn(o2['id'], eng.index)
        self.assertEqual(eng.index[o2['id']].qty, 10)

    def test_partial_fill(self):
        eng = Engine()
        eng.add_symbol('AAPL')

        maker = eng.place('AAPL', 'S', 'LIMIT', 100, 10)
        taker = eng.place('AAPL', 'B', 'LIMIT', 100, 4)

        self.assertEqual(taker['status'], 'FILLED')
        self.assertEqual(taker['remaining'], 0)

        resting = eng.index.get(maker['id'])
        self.assertIsNotNone(resting)
        self.assertEqual(resting.qty, 6)

        level = eng.books['AAPL'].asks.get(10000)
        self.assertIsNotNone(level)
        self.assertEqual(level.total, 6)
        self.assertEqual(level.count, 1)

    def test_cancelled_order(self):
        eng = Engine()
        eng.add_symbol('AAPL')

        o = eng.place('AAPL', 'S', 'LIMIT', 100, 10)
        self.assertIn(o['id'], eng.index)

        cancelled_sym = eng.cancel(o['id'])
        self.assertEqual(cancelled_sym, 'AAPL')
        self.assertNotIn(o['id'], eng.index)

        level = eng.books['AAPL'].asks.get(10000)
        self.assertIsNone(level)

        # Place matching order - should not match anything
        res = eng.place('AAPL', 'B', 'LIMIT', 100, 10)
        self.assertEqual(res['status'], 'OPEN')
        self.assertEqual(len(res['fills']), 0)
        self.assertEqual(res['remaining'], 10)

    def test_market_order_sweep(self):
        eng = Engine()
        eng.add_symbol('AAPL')

        eng.place('AAPL', 'S', 'LIMIT', 100, 5)
        eng.place('AAPL', 'S', 'LIMIT', 101, 5)
        eng.place('AAPL', 'S', 'LIMIT', 102, 5)

        # Market buy for 20 when only 15 available across 3 levels
        res = eng.place('AAPL', 'B', 'MARKET', 0, 20)

        self.assertEqual(res['status'], 'CANCELLED_REMAINDER')
        self.assertEqual(res['remaining'], 5)
        self.assertEqual(len(res['fills']), 3)
        self.assertEqual(res['fills'][0].price, 100)
        self.assertEqual(res['fills'][0].qty, 5)
        self.assertEqual(res['fills'][1].price, 101)
        self.assertEqual(res['fills'][1].qty, 5)
        self.assertEqual(res['fills'][2].price, 102)
        self.assertEqual(res['fills'][2].qty, 5)

        book = eng.books['AAPL']
        self.assertIsNone(book.asks.best(False))
        self.assertIsNone(book.bids.best(True))

    def test_trie_search(self):
        trie = Trie()
        tickers = ['AAPL', 'AMZN', 'GOOG', 'META', 'MSFT', 'NFLX', 'NVDA', 'TSLA']
        for t in tickers:
            trie.insert(t)

        res = trie.search('N')
        self.assertEqual(res, ['NFLX', 'NVDA'])

        # Case-insensitivity
        res_lower = trie.search('n')
        self.assertEqual(res_lower, ['NFLX', 'NVDA'])

    def test_circular_queue(self):
        q = CircularQueue(1000)
        for i in range(1, 1001):
            q.push({"id": i})

        self.assertEqual(q.size, 1000)

        # 1001st item
        q.push({"id": 1001})
        self.assertEqual(q.size, 1000)

        recent = q.recent(1000)
        self.assertEqual(len(recent), 1000)
        self.assertEqual(recent[0]['id'], 1001)
        self.assertEqual(recent[-1]['id'], 2)
        self.assertFalse(any(x['id'] == 1 for x in recent))

    def test_validation(self):
        eng = Engine()
        eng.add_symbol('AAPL')

        # Unknown symbol
        with self.assertRaises(ValueError) as ctx:
            eng.place('UNKNOWN', 'B', 'LIMIT', 100, 10)
        self.assertIn('Unknown symbol', str(ctx.exception))

        # Non-positive qty (0)
        with self.assertRaises(ValueError) as ctx:
            eng.place('AAPL', 'B', 'LIMIT', 100, 0)
        self.assertIn('Quantity must be a positive integer', str(ctx.exception))

        # Negative qty
        with self.assertRaises(ValueError) as ctx:
            eng.place('AAPL', 'B', 'LIMIT', 100, -5)
        self.assertIn('Quantity must be a positive integer', str(ctx.exception))

        # Non-integer qty
        with self.assertRaises(ValueError) as ctx:
            eng.place('AAPL', 'B', 'LIMIT', 100, 2.5)  # type: ignore
        self.assertIn('Quantity must be a positive integer', str(ctx.exception))

        # Limit price <= 0
        with self.assertRaises(ValueError) as ctx:
            eng.place('AAPL', 'B', 'LIMIT', 0, 10)
        self.assertIn('Limit price must be > 0', str(ctx.exception))

        with self.assertRaises(ValueError) as ctx:
            eng.place('AAPL', 'B', 'LIMIT', -10, 10)
        self.assertIn('Limit price must be > 0', str(ctx.exception))

if __name__ == '__main__':
    unittest.main()
