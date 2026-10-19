import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { WebSocketServer, WebSocket } from 'ws';
import { Engine, Side, Trade } from './engine.js';
import { MarketSim, UNIVERSE } from './market.js';
import { Portfolio } from './portfolio.js';

const eng = new Engine();
const sim = new MarketSim(eng);
const portfolio = new Portfolio(eng);

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const selected = new WeakMap<WebSocket, string>();

const send = (m: unknown) => {
  const s = JSON.stringify(m);
  wss.clients.forEach(c => c.readyState === WebSocket.OPEN && c.send(s));
};

const snapshot = (symbol: string) => {
  const book = eng.books.get(symbol.toUpperCase());
  return book ? book.snapshot() : null;
};

function sendPortfolio() {
  send({ type: 'portfolio', portfolio: portfolio.snapshot(portfolio.livePrices()) });
}

function run<T>(res: express.Response, fn: () => T) {
  try {
    res.json(fn());
  } catch (e: any) {
    res.status(400).json({ error: e.message || 'Bad Request' });
  }
}

/* ------------------------------- REST ---------------------------------- */

app.get('/api/bootstrap', (_req, res) => {
  const symbols = UNIVERSE.map(meta => {
    const tick = sim.snapshot(meta.symbol)!;
    return {
      symbol: meta.symbol,
      name: meta.name,
      sector: meta.sector,
      ...tick,
      spark: sim.spark(meta.symbol),
    };
  });
  res.json({
    symbols,
    portfolio: portfolio.snapshot(portfolio.livePrices()),
    serverTime: Date.now(),
  });
});

app.get('/api/candles/:symbol', (req, res) =>
  run(res, () => {
    const sym = req.params.symbol.toUpperCase();
    const candles = sim.candles(sym);
    if (!candles.length) throw new Error('Unknown symbol');
    return { symbol: sym, candleMs: 60_000, candles };
  })
);

app.get('/api/book/:symbol', (req, res) =>
  run(res, () => {
    const sym = req.params.symbol.toUpperCase();
    const book = eng.books.get(sym);
    if (!book) throw new Error('Unknown symbol');
    return {
      ...book.snapshot(),
      trades: eng.trades.recent(200).filter(t => t.symbol === sym).slice(0, 40),
    };
  })
);

app.post('/api/orders', (req, res) =>
  run(res, () => {
    const { symbol, side, type, price, qty } = req.body ?? {};
    if (!['B', 'S'].includes(side) || !['LIMIT', 'MARKET'].includes(type)) {
      throw new Error('Invalid side/type');
    }
    const sym = String(symbol ?? '').toUpperCase();
    const result = portfolio.place(sym, side as Side, type, Number(price), Number(qty));
    if (result.fills.length) send({ type: 'trades', trades: result.fills });
    send({ type: 'book', ...snapshot(sym)! });
    sendPortfolio();
    return result;
  })
);

app.delete('/api/orders/:id', (req, res) =>
  run(res, () => {
    const sym = portfolio.cancel(req.params.id);
    if (!sym) throw new Error('Order not found');
    send({ type: 'book', ...snapshot(sym)! });
    sendPortfolio();
    return { cancelled: req.params.id };
  })
);

app.get('/api/search', (req, res) => {
  res.json(eng.trie.search(String(req.query.q ?? '').toUpperCase()));
});

app.get('/api/portfolio', (_req, res) => {
  res.json(portfolio.snapshot(portfolio.livePrices()));
});

app.post('/api/portfolio/reset', (_req, res) => {
  res.json(portfolio.reset(portfolio.livePrices()));
  sendPortfolio();
});

app.post('/api/reset', (_req, res) => {
  sim.reset();
  portfolio.reset(portfolio.livePrices());
  res.json({ ok: true });
  sendPortfolio();
});

/* --------------------------- static frontend --------------------------- */

const distDir = process.env.DIST_DIR ?? path.resolve('dist');
app.use(express.static(distDir));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next();
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.status(404).send('Not Found');
  }
});

/* ------------------------------- sockets -------------------------------- */

wss.on('connection', ws => {
  selected.set(ws, 'AAPL');
  ws.send(JSON.stringify({ type: 'hello', serverTime: Date.now() }));
  const book = snapshot('AAPL');
  if (book) ws.send(JSON.stringify({ type: 'book', ...book }));
  ws.send(JSON.stringify({ type: 'portfolio', portfolio: portfolio.snapshot(portfolio.livePrices()) }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'select' && typeof msg.symbol === 'string') {
        const sym = msg.symbol.toUpperCase();
        if (!eng.books.has(sym)) return;
        selected.set(ws, sym);
        const snap = snapshot(sym);
        if (snap) ws.send(JSON.stringify({ type: 'book', ...snap }));
      }
    } catch {
      /* ignore malformed frames */
    }
  });
});

/* ------------------------------ market loop ----------------------------- */

const TICK_MS = 250;
let lastPortfolioAt = 0;

setInterval(() => {
  try {
    const { snapshots, fills } = sim.tick(TICK_MS);
    if (fills.length) {
      send({ type: 'trades', trades: fills });
    }
    send({ type: 'ticks', ts: Date.now(), ticks: snapshots });

    // Depth is only needed for the symbol each client is watching.
    const books = new Map<string, unknown>();
    wss.clients.forEach(client => {
      if (client.readyState !== WebSocket.OPEN) return;
      const sym = selected.get(client);
      if (!sym) return;
      if (!books.has(sym)) books.set(sym, snapshot(sym));
      const book = books.get(sym);
      if (book) client.send(JSON.stringify({ type: 'book', ...(book as object) }));
    });

    const now = Date.now();
    portfolio.sync();
    if (now - lastPortfolioAt >= 1000) {
      lastPortfolioAt = now;
      portfolio.sample(portfolio.livePrices(), now);
      sendPortfolio();
    }
  } catch (e) {
    console.error('[market loop]', e);
  }
}, TICK_MS);

const PORT = Number(process.env.PORT) || 4000;
server.listen(PORT, () => {
  console.log(`Engine running on http://localhost:${PORT} (ws /ws)`);
});

export { eng, sim, portfolio };
