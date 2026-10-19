import { Engine } from '../server/engine.js';
import { MarketSim, HISTORY_LEN } from '../server/market.js';
import { Portfolio } from '../server/portfolio.js';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

console.log('=== RUNNING MARKET & PORTFOLIO ACCEPTANCE TESTS ===\n');

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

/* --------------------------------------------------------------------------
 * Market realism
 * ------------------------------------------------------------------------ */

test('Candles: 8 hours of history with valid OHLC and two-way movement', () => {
  const eng = new Engine();
  const sim = new MarketSim(eng);
  const candles = sim.candles('AAPL');

  assert(candles.length === HISTORY_LEN + 1, `Expected ${HISTORY_LEN + 1} candles, got ${candles.length}`);

  let ups = 0;
  let downs = 0;
  let prevClose = candles[0].c;
  for (const c of candles) {
    assert(c.h >= Math.max(c.o, c.c), 'high must bound open/close');
    assert(c.l <= Math.min(c.o, c.c), 'low must bound open/close');
    assert(c.h >= c.l, 'high must be >= low');
    assert(c.o > 0 && c.c > 0, 'prices must be positive');
    assert(c.v >= 0, 'volume must be non-negative');
    if (c.c > c.o) ups++;
    if (c.c < c.o) downs++;
    prevClose = c.c;
  }
  assert(ups > 100, `Expected plenty of green candles, got ${ups}`);
  assert(downs > 100, `Expected plenty of red candles, got ${downs}`);
  assert(prevClose > 0, 'last close should be positive');
});

test('Market: every symbol trades both sides and price oscillates', () => {
  const eng = new Engine();
  const sim = new MarketSim(eng);
  const marks: Record<string, number[]> = {};
  let buyFills = 0;
  let sellFills = 0;

  for (let i = 0; i < 160; i++) {
    const { snapshots, fills } = sim.tick(250, Date.now() + i * 250);
    for (const f of fills) {
      if (f.side === 'B') buyFills++;
      else sellFills++;
    }
    for (const s of snapshots) {
      (marks[s.symbol] ??= []).push(s.price);
    }
  }

  assert(buyFills > 40, `Expected two-sided buy flow, got ${buyFills}`);
  assert(sellFills > 40, `Expected two-sided sell flow, got ${sellFills}`);

  let movedUp = 0;
  let movedDown = 0;
  for (const series of Object.values(marks)) {
    for (let i = 1; i < series.length; i++) {
      if (series[i] > series[i - 1]) movedUp++;
      if (series[i] < series[i - 1]) movedDown++;
    }
  }
  assert(movedUp > 50, `Expected upward ticks, got ${movedUp}`);
  assert(movedDown > 50, `Expected downward ticks, got ${movedDown}`);

  // No symbol may trend one way for the entire run (the old bot's failure mode),
  // and prices must actually move rather than sitting still.
  let crossedOpen = 0;
  for (const [symbol, series] of Object.entries(marks)) {
    const first = series[0];
    const last = series[series.length - 1];
    const drift = Math.abs((last - first) / first);
    assert(drift < 0.12, `${symbol} drifted ${(drift * 100).toFixed(1)}% in 40s`);
    const min = Math.min(...series);
    const max = Math.max(...series);
    assert((max - min) / first > 0.0004, `${symbol} barely moved`);
    if (min < first && max > first) crossedOpen++;
  }
  assert(crossedOpen >= 4, `Only ${crossedOpen}/8 symbols moved both ways of their open`);
});

test('Candles: live ticks keep the forming candle consistent', () => {
  const eng = new Engine();
  const sim = new MarketSim(eng);
  const t0 = Date.now();
  for (let i = 0; i < 12; i++) sim.tick(250, t0 + i * 1500);
  const live = sim.candles('NVDA').at(-1)!;
  assert(live.h >= Math.max(live.o, live.c), 'live high bounds open/close');
  assert(live.l <= Math.min(live.o, live.c), 'live low bounds open/close');
  assert(live.v >= 0, 'live volume non-negative');
});

/* --------------------------------------------------------------------------
 * Portfolio
 * ------------------------------------------------------------------------ */

function freshBook() {
  const eng = new Engine();
  eng.addSymbol('AAPL');
  eng.place('AAPL', 'S', 'LIMIT', 100, 100);
  eng.place('AAPL', 'B', 'LIMIT', 99, 100);
  const pf = new Portfolio(eng);
  return { eng, pf };
}

test('Portfolio: market buy debits cash and opens a position', () => {
  const { pf } = freshBook();
  assert(pf.cash === 100000, 'starts with $100,000');
  const res = pf.place('AAPL', 'B', 'MARKET', 0, 10);
  assert(res.filledQty === 10, `expected 10 filled, got ${res.filledQty}`);
  assert(Math.abs(res.avgPrice - 100) < 1e-9, `expected $100 fill, got ${res.avgPrice}`);
  assert(Math.abs(pf.cash - 99000) < 1e-6, `cash should be 99000, got ${pf.cash}`);
  const pos = pf.positions.get('AAPL')!;
  assert(pos.qty === 10, `position qty 10, got ${pos.qty}`);
  assert(Math.abs(pos.avg - 100) < 1e-9, `avg cost 100, got ${pos.avg}`);
});

test('Portfolio: sells realize P&L and reject overselling', () => {
  const { eng, pf } = freshBook();
  pf.place('AAPL', 'B', 'MARKET', 0, 10);
  eng.place('AAPL', 'B', 'LIMIT', 110, 100);

  const res = pf.place('AAPL', 'S', 'MARKET', 0, 4);
  assert(res.filledQty === 4, 'sold 4 shares');
  const pos = pf.positions.get('AAPL')!;
  assert(pos.qty === 6, `position 6, got ${pos.qty}`);
  assert(Math.abs(pos.realized - 40) < 1e-6, `realized +40, got ${pos.realized}`);
  assert(Math.abs(pf.cash - (99000 + 440)) < 1e-6, 'cash credited by sale');

  let threw = false;
  try {
    pf.place('AAPL', 'S', 'MARKET', 0, 7);
  } catch (e: any) {
    threw = true;
    assert(/Not enough shares/.test(e.message), `unexpected error ${e.message}`);
  }
  assert(threw, 'overselling must throw');
});

test('Portfolio: limit buys reserve buying power and cancel releases it', () => {
  const { pf } = freshBook();
  const res = pf.place('AAPL', 'B', 'LIMIT', 90, 10);
  assert(res.status === 'OPEN', 'limit order should rest');
  assert(Math.abs(pf.availableCash() - (100000 - 900)) < 1e-6, 'reserves $900');

  const before = pf.availableCash();
  pf.cancel(res.id);
  assert(Math.abs(pf.availableCash() - (before + 900)) < 1e-6, 'cancel releases reserve');
  assert(pf.orders.size === 0, 'order removed');
});

test('Portfolio: insufficient buying power is rejected', () => {
  const { pf } = freshBook();
  let threw = false;
  try {
    pf.place('AAPL', 'B', 'LIMIT', 100, 5000);
  } catch (e: any) {
    threw = true;
    assert(/Insufficient buying power/.test(e.message), `unexpected error ${e.message}`);
  }
  assert(threw, 'oversized order must throw');
  assert(pf.cash === 100000, 'cash untouched');
});

test('Portfolio: resting orders book maker fills', () => {
  const { eng, pf } = freshBook();
  // Take the entire seeded ask so the only remaining liquidity is the user's.
  pf.place('AAPL', 'B', 'MARKET', 0, 100);
  const resting = pf.place('AAPL', 'S', 'LIMIT', 108, 5);
  assert(resting.remaining === 5, 'sell limit rests');

  // Incoming aggressor crosses the resting user ask; it must settle in the portfolio.
  eng.place('AAPL', 'B', 'LIMIT', 109, 5);
  pf.sync();

  const pos = pf.positions.get('AAPL')!;
  assert(pos.qty === 95, `position should drop to 95, got ${pos.qty}`);
  assert(Math.abs(pos.realized - 40) < 1e-6, `realized +40, got ${pos.realized}`);
  assert(pf.orders.size === 0, 'filled maker order should leave the book');
});

console.log(`\n=== SUMMARY: ${passed}/8 MARKET & PORTFOLIO TESTS PASSED ===\n`);
