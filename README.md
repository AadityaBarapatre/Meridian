# Meridian — Paper Trading Terminal & Matching Engine

A full-stack trading terminal: a handcrafted low-latency matching engine, a stochastic
market simulator with realistic candle formation, and a glassmorphic React UI with large
canvas candlestick charts, a live order book and a paper portfolio.

---

## What it does

- **Realistic tape.** Eight symbols follow an Ornstein–Uhlenbeck style log-price process
  with drifting anchors, volatility shocks and slowly reversing trends. Prices trend,
  chop, retrace and mean-revert — they never drift one way forever.
- **Candlesticks.** The server keeps 8 hours of one-minute OHLCV candles per symbol and
  rolls the live candle on every 250 ms tick, so the chart breathes continuously.
- **Two-sided flow.** Every tick replenishes 14 levels per side around the mid and prints
  aggressive buys and sells in both directions. The time & sales tape shows a live
  buy/sell flow meter.
- **Paper portfolio.** $100,000 starting cash, market and limit orders, reservations for
  resting orders, realized/unrealized P&L, allocation, and an equity curve. Fills that
  touch your resting orders are booked whether you crossed the spread or were hit by a
  synthetic taker.
- **Premium chart.** A dependency-free canvas renderer with EMA overlays, volume profile,
  crosshair + OHLC tooltip, price/time axes, scroll-to-zoom and eased scale transitions.

---

## Architecture

### `server/engine.ts` — matching engine

Handcrafted data structures, no third-party libraries:

1. **Price Level Index — Treap** (self-balancing BST keyed by integer cents) for
   `O(log P)` insert/delete and `O(1)` best-price lookups via pointer traversal.
2. **Price Level Queue — Doubly Linked List** giving strict price–time priority with
   `O(1)` enqueue and unlink anywhere in the queue.
3. **Order Lookup — Hash Map** (`Map<orderId, OrderNode>`) for `O(1)` cancels.
4. **Symbol Routing — Trie** for `O(K)` ticker autocomplete.
5. **Trade History — Circular Queue** (1000 trades) with newest-first reads.
6. **Integer Cent Arithmetic** to avoid floating-point price hazards.

The engine exposes an `onMakerFill` hook so the portfolio can book maker fills too.

### `server/market.ts` — market simulator

- Log-price process: mean reversion toward a slowly wandering anchor + per-minute
  volatility + rare jumps + a flipping trend regime, giving genuine bull and bear legs.
- `buildHistory()` pre-generates 480 one-minute candles (8 hours) per symbol so charts
  are populated the moment the app opens.
- Each live tick advances the mark, rolls the candle, rebuilds synthetic depth around the
  new mid, and prints one or two market orders whose direction leans only lightly against
  the last move.

### `server/portfolio.ts` — paper account

Cash, positions (qty, average cost, realized P&L), resting-order reservations, equity
sampling (1 Hz, 900 points) and mark-to-market snapshots.

### `server/server.ts` — API + realtime

Express REST, `ws` WebSockets, 250 ms market loop, per-client depth subscriptions.

---

## Project structure

```
├── electron/
│   ├── main.cjs            # Electron main process (1400x900 window)
│   └── server.cjs          # Bundled backend produced by esbuild
├── server/
│   ├── engine.ts           # Matching engine and data structures
│   ├── market.ts           # Price process, candles, synthetic depth
│   ├── portfolio.ts        # Paper account, reservations, P&L
│   └── server.ts           # REST + WebSocket + market loop
├── src/
│   ├── App.tsx             # Terminal shell, routing, realtime state
│   ├── types.ts            # Shared client types
│   ├── lib/format.ts       # Number/currency/time formatting
│   ├── components/
│   │   ├── CandleChart.tsx     # Canvas candles, EMA, crosshair, zoom
│   │   ├── EquityChart.tsx     # Account equity area chart
│   │   ├── MarketWatch.tsx     # Watchlist with sparklines
│   │   ├── OrderBook.tsx       # Depth with cumulative bars
│   │   ├── TradeFeed.tsx       # Time & sales with flow meter
│   │   ├── TradePanel.tsx      # Market/limit buy-sell ticket
│   │   ├── PortfolioView.tsx   # Holdings, allocation, orders dashboard
│   │   ├── Sparkline.tsx       # Inline SVG sparkline
│   │   └── BackgroundCanvas.tsx
│   └── styles/glass.css    # Design system
├── test/
│   ├── engine.test.ts      # 8 engine acceptance tests
│   └── market.test.ts      # 8 simulator + portfolio tests
├── index.html
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Setup & running

```bash
npm install     # install dependencies
npm test        # engine + market/portfolio acceptance tests
npm run dev     # Express + WS on :4000, Vite dev server on :5173
npm run desktop # production build + Electron window
npm run dist    # package with electron-builder
```

## REST API

| Endpoint | Method | Description |
|---|---|---|
| `/api/bootstrap` | `GET` | Symbol universe, tickers, sparklines, portfolio snapshot |
| `/api/candles/:symbol` | `GET` | 8 hours of one-minute OHLCV candles + live candle |
| `/api/book/:symbol` | `GET` | Depth snapshot and recent prints |
| `/api/orders` | `POST` | `{ symbol, side: 'B'\|'S', type: 'LIMIT'\|'MARKET', price, qty }` |
| `/api/orders/:id` | `DELETE` | Cancel a resting order |
| `/api/portfolio` | `GET` | Cash, positions, orders, equity history |
| `/api/portfolio/reset` | `POST` | Reset the paper account to $100,000 |
| `/api/reset` | `POST` | Regenerate the whole market and account |

## WebSocket API (`/ws`)

Client may send `{ type: 'select', symbol }` to subscribe to a symbol's depth.

- `{ type: 'ticks', ts, ticks: [...] }` — 250 ms price/candle updates for all symbols.
- `{ type: 'trades', trades: [...] }` — aggressive prints.
- `{ type: 'book', ... }` — depth for the subscribed symbol.
- `{ type: 'portfolio', portfolio }` — account snapshot every second and after any order.

---

Everything is simulated: no real money, no live market data. The paper account lives in
the running server process, so restarting the engine resets it.
