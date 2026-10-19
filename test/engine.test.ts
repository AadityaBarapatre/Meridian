import { Engine, Trie, CircularQueue } from '../server/engine.js';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

console.log('=== RUNNING ENGINE ACCEPTANCE UNIT TESTS ===\n');

let passedCount = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passedCount++;
  } catch (err: any) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Price priority: a better-priced resting order fills before a worse-priced one.
test('Price priority: better-priced resting order fills first', () => {
  const eng = new Engine();
  eng.addSymbol('AAPL');

  // Resting asks: worse price ($102) placed first, better price ($100) placed second
  eng.place('AAPL', 'S', 'LIMIT', 102, 10);
  eng.place('AAPL', 'S', 'LIMIT', 100, 10);

  // Incoming buy for 10 @ $105 should match the better ask ($100)
  const resBuy = eng.place('AAPL', 'B', 'LIMIT', 105, 10);
  assert(resBuy.fills.length === 1, 'Expected 1 fill');
  assert(resBuy.fills[0].price === 100, `Expected fill price 100, got ${resBuy.fills[0].price}`);

  // Resting bids: worse price ($98) placed first, better price ($100) placed second
  eng.place('AAPL', 'B', 'LIMIT', 98, 10);
  eng.place('AAPL', 'B', 'LIMIT', 100, 10);

  // Incoming sell for 10 @ $95 should match the better bid ($100)
  const resSell = eng.place('AAPL', 'S', 'LIMIT', 95, 10);
  assert(resSell.fills.length === 1, 'Expected 1 fill');
  assert(resSell.fills[0].price === 100, `Expected fill price 100, got ${resSell.fills[0].price}`);
});

// 2. Time priority: at the same price, the older order fills first.
test('Time priority: at the same price, older order fills first', () => {
  const eng = new Engine();
  eng.addSymbol('AAPL');

  // Two sell orders at the same price ($100)
  const o1 = eng.place('AAPL', 'S', 'LIMIT', 100, 10);
  const o2 = eng.place('AAPL', 'S', 'LIMIT', 100, 10);

  // Incoming buy for 10 @ $100 fills exactly one resting order
  const res = eng.place('AAPL', 'B', 'LIMIT', 100, 10);
  assert(res.fills.length === 1, 'Expected 1 fill');

  // Verify O1 was consumed (not in index) and O2 remains resting in index
  assert(!eng.index.has(o1.id), `Order ${o1.id} should have been filled and removed`);
  assert(eng.index.has(o2.id), `Order ${o2.id} should still be resting`);
  assert(eng.index.get(o2.id)!.qty === 10, 'Remaining resting order qty should be 10');
});

// 3. A partial fill leaves the correct remainder resting.
test('Partial fill: leaves the correct remainder resting', () => {
  const eng = new Engine();
  eng.addSymbol('AAPL');

  const maker = eng.place('AAPL', 'S', 'LIMIT', 100, 10);
  const taker = eng.place('AAPL', 'B', 'LIMIT', 100, 4);

  assert(taker.status === 'FILLED', `Expected taker FILLED, got ${taker.status}`);
  assert(taker.remaining === 0, 'Taker remaining should be 0');

  const resting = eng.index.get(maker.id);
  assert(!!resting, 'Maker order should still be in index');
  assert(resting!.qty === 6, `Expected resting qty 6, got ${resting!.qty}`);

  const level = eng.books.get('AAPL')!.asks.get(10000);
  assert(!!level, 'Price level 10000 should exist');
  assert(level!.total === 6, `Expected level total 6, got ${level!.total}`);
  assert(level!.count === 1, `Expected level count 1, got ${level!.count}`);
});

// 4. A cancelled order is never matched, and its empty level is removed.
test('Cancelled order: never matched and empty level removed', () => {
  const eng = new Engine();
  eng.addSymbol('AAPL');

  const o = eng.place('AAPL', 'S', 'LIMIT', 100, 10);
  assert(eng.index.has(o.id), 'Order should be indexed');

  const cancelledSym = eng.cancel(o.id);
  assert(cancelledSym === 'AAPL', `Expected cancelled symbol AAPL, got ${cancelledSym}`);
  assert(!eng.index.has(o.id), 'Order should no longer be indexed');

  const level = eng.books.get('AAPL')!.asks.get(10000);
  assert(level === undefined, 'Price level should have been removed from tree');

  // Place matching order - should not match anything
  const res = eng.place('AAPL', 'B', 'LIMIT', 100, 10);
  assert(res.status === 'OPEN', `Expected status OPEN, got ${res.status}`);
  assert(res.fills.length === 0, 'Expected 0 fills');
  assert(res.remaining === 10, 'Expected remaining 10');
});

// 5. A market order sweeps multiple levels and discards any unfilled remainder.
test('Market order: sweeps multiple levels and discards unfilled remainder', () => {
  const eng = new Engine();
  eng.addSymbol('AAPL');

  eng.place('AAPL', 'S', 'LIMIT', 100, 5);
  eng.place('AAPL', 'S', 'LIMIT', 101, 5);
  eng.place('AAPL', 'S', 'LIMIT', 102, 5);

  // Market buy for 20 when only 15 available across 3 levels
  const res = eng.place('AAPL', 'B', 'MARKET', 0, 20);

  assert(res.status === 'CANCELLED_REMAINDER', `Expected CANCELLED_REMAINDER, got ${res.status}`);
  assert(res.remaining === 5, `Expected remaining 5, got ${res.remaining}`);
  assert(res.fills.length === 3, `Expected 3 fills, got ${res.fills.length}`);
  assert(res.fills[0].price === 100 && res.fills[0].qty === 5, 'Fill 1 mismatch');
  assert(res.fills[1].price === 101 && res.fills[1].qty === 5, 'Fill 2 mismatch');
  assert(res.fills[2].price === 102 && res.fills[2].qty === 5, 'Fill 3 mismatch');

  // Book should have no asks left, and market order remainder should NOT rest in bids
  const book = eng.books.get('AAPL')!;
  assert(book.asks.best(false) === undefined, 'Asks should be empty');
  assert(book.bids.best(true) === undefined, 'Bids should be empty');
});

// 6. Trie search('N') returns NFLX and NVDA.
test("Trie: search('N') returns NFLX and NVDA", () => {
  const trie = new Trie();
  const tickers = ['AAPL', 'AMZN', 'GOOG', 'META', 'MSFT', 'NFLX', 'NVDA', 'TSLA'];
  tickers.forEach(t => trie.insert(t));

  const res = trie.search('N');
  assert(res.length === 2, `Expected 2 tickers, got ${res.length}`);
  assert(res[0] === 'NFLX', `Expected res[0] NFLX, got ${res[0]}`);
  assert(res[1] === 'NVDA', `Expected res[1] NVDA, got ${res[1]}`);

  // Also test case-insensitivity
  const resLower = trie.search('n');
  assert(JSON.stringify(resLower) === JSON.stringify(['NFLX', 'NVDA']), 'Lowercase search mismatch');
});

// 7. The circular queue overwrites the oldest trade after 1000 pushes.
test('Circular queue: overwrites oldest trade after 1000 pushes', () => {
  const q = new CircularQueue<{ id: number }>(1000);

  for (let i = 1; i <= 1000; i++) {
    q.push({ id: i });
  }
  assert(q.size === 1000, `Expected size 1000, got ${q.size}`);

  // Push the 1001st trade
  q.push({ id: 1001 });
  assert(q.size === 1000, `Size should remain 1000 after wrap, got ${q.size}`);

  const recent = q.recent(1000);
  assert(recent.length === 1000, `Expected 1000 recent items, got ${recent.length}`);
  assert(recent[0].id === 1001, `Newest item should be 1001, got ${recent[0].id}`);
  assert(recent[recent.length - 1].id === 2, `Oldest item should be 2, got ${recent[recent.length - 1].id}`);
  assert(!recent.some(x => x.id === 1), 'Item 1 should have been overwritten');
});

// 8. Invalid inputs throw.
test('Validation: invalid inputs throw clear errors', () => {
  const eng = new Engine();
  eng.addSymbol('AAPL');

  // Unknown symbol
  let threw = false;
  try {
    eng.place('UNKNOWN', 'B', 'LIMIT', 100, 10);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Unknown symbol'), `Unexpected message: ${err.message}`);
  }
  assert(threw, 'Unknown symbol should throw');

  // Non-positive qty (0)
  threw = false;
  try {
    eng.place('AAPL', 'B', 'LIMIT', 100, 0);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Quantity must be a positive integer'), `Unexpected message: ${err.message}`);
  }
  assert(threw, 'Qty 0 should throw');

  // Negative qty
  threw = false;
  try {
    eng.place('AAPL', 'B', 'LIMIT', 100, -5);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Quantity must be a positive integer'), `Unexpected message: ${err.message}`);
  }
  assert(threw, 'Negative qty should throw');

  // Non-integer qty
  threw = false;
  try {
    eng.place('AAPL', 'B', 'LIMIT', 100, 2.5);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Quantity must be a positive integer'), `Unexpected message: ${err.message}`);
  }
  assert(threw, 'Decimal qty should throw');

  // Limit price <= 0
  threw = false;
  try {
    eng.place('AAPL', 'B', 'LIMIT', 0, 10);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Limit price must be > 0'), `Unexpected message: ${err.message}`);
  }
  assert(threw, 'Price 0 should throw');

  threw = false;
  try {
    eng.place('AAPL', 'B', 'LIMIT', -10, 10);
  } catch (err: any) {
    threw = true;
    assert(err.message.includes('Limit price must be > 0'), `Unexpected message: ${err.message}`);
  }
  assert(threw, 'Negative price should throw');
});

console.log(`\n=== SUMMARY: ${passedCount}/8 UNIT TESTS PASSED ===\n`);
