import { Engine, Side } from './engine.js';

/* ============================================================================
 * Synthetic market — a mean-reverting stochastic price process with realistic
 * candle formation, synthetic depth and two-sided order flow.
 *
 * The old "market maker" always leaned one way, so the last price drifted up
 * forever. This module replaces it with an Ornstein-Uhlenbeck style log-price
 * process around a slowly wandering anchor: prices trend, chop, retrace and
 * mean-revert, and both sides of the book are replenished every tick.
 * ========================================================================== */

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface SymbolMeta {
  symbol: string;
  name: string;
  sector: string;
  base: number;
  vol: number;
  drift: number;
}

export const UNIVERSE: SymbolMeta[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', base: 191.24, vol: 0.0016, drift: 0.00004 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', sector: 'Technology', base: 421.66, vol: 0.0015, drift: 0.00005 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', sector: 'Semiconductors', base: 894.5, vol: 0.0031, drift: 0.00009 },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Automotive', base: 176.88, vol: 0.0034, drift: -0.00003 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer', base: 182.34, vol: 0.0019, drift: 0.00005 },
  { symbol: 'GOOG', name: 'Alphabet Inc.', sector: 'Communication', base: 152.11, vol: 0.0017, drift: 0.00003 },
  { symbol: 'META', name: 'Meta Platforms', sector: 'Communication', base: 482.73, vol: 0.0022, drift: 0.00006 },
  { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Entertainment', base: 621.4, vol: 0.0024, drift: 0.00002 },
];

export const CANDLE_MS = 60_000;
export const HISTORY_LEN = 480; // 8 hours of one-minute candles
const TICK_SUBSTEPS = 6;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Box-Muller normal. */
function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

interface SimState {
  meta: SymbolMeta;
  logP: number;
  anchor: number; // log anchor
  momentum: number;
  trend: number; // slowly flipping drift regime
  candle: Candle;
  history: Candle[];
  botIds: Set<string>;
  spreadPct: number;
}

export interface TickSnapshot {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  candle: Candle;
}

export interface FillEvent {
  id: number;
  symbol: string;
  price: number;
  qty: number;
  side: Side;
  ts: number;
}

function makeCandle(t: number, price: number): Candle {
  return { t, o: price, h: price, l: price, c: price, v: 0 };
}

function advance(state: SimState, minutes: number, driftStep = false) {
  const { meta } = state;
  const theta = 0.024; // pull toward anchor per minute
  if (driftStep) {
    // Anchor wanders and trends slowly reverse; keeps the chart from running away.
    state.anchor += meta.drift * minutes + 0.0011 * Math.sqrt(minutes) * gauss();
    if (Math.random() < minutes / 42) state.trend = -state.trend;
  }
  const shock = (Math.random() < 0.004 ? (Math.random() < 0.5 ? -1 : 1) * (0.0025 + Math.random() * 0.006) : 0);
  state.logP +=
    theta * (state.anchor - state.logP) * minutes +
    meta.vol * Math.sqrt(minutes) * gauss() +
    shock +
    state.trend * minutes;
  state.momentum = state.momentum * (1 - 0.22 * minutes) + 0.24 * Math.sqrt(minutes) * gauss();
}

/** Build a coherent 8-hour candle history and return the newest state. */
function buildHistory(meta: SymbolMeta, now: number): { history: Candle[]; logP: number; anchor: number } {
  let logP = Math.log(meta.base * (0.985 + Math.random() * 0.03));
  let anchor = logP;
  let trend = (Math.random() - 0.5) * 0.0005;
  const endT = Math.floor(now / CANDLE_MS) * CANDLE_MS;
  const startT = endT - HISTORY_LEN * CANDLE_MS;
  const history: Candle[] = [];
  const state: SimState = {
    meta,
    logP,
    anchor,
    momentum: 0,
    trend,
    candle: makeCandle(startT, Math.exp(logP)),
    history: [],
    botIds: new Set(),
    spreadPct: 0.00022,
  };

  for (let i = 0; i < HISTORY_LEN; i++) {
    const t = startT + i * CANDLE_MS;
    const open = Math.exp(state.logP);
    let high = open;
    let low = open;
    let close = open;
    let volume = 0;
    for (let s = 0; s < TICK_SUBSTEPS; s++) {
      advance(state, 1 / TICK_SUBSTEPS, s === 0);
      const px = Math.exp(state.logP);
      high = Math.max(high, px);
      low = Math.min(low, px);
      close = px;
      volume += 40 + Math.random() * 900;
    }
    logP = state.logP;
    anchor = state.anchor;
    const o = r2(open);
    const c = r2(close);
    const candle: Candle = {
      t,
      o,
      h: r2(Math.max(high, o, c)),
      l: r2(Math.min(low, o, c)),
      c,
      v: Math.round(volume),
    };
    history.push(candle);
  }
  return { history, logP, anchor };
}

export class MarketSim {
  readonly states = new Map<string, SimState>();
  private tradeSeq = 0;

  constructor(private eng: Engine, private now = Date.now()) {
    for (const meta of UNIVERSE) {
      eng.addSymbol(meta.symbol);
      const { history, logP, anchor } = buildHistory(meta, now);
      const price = Math.exp(logP);
      const t = Math.floor(now / CANDLE_MS) * CANDLE_MS;
      const state: SimState = {
        meta,
        logP,
        anchor,
        momentum: 0,
        trend: (Math.random() - 0.5) * 0.0005,
        candle: makeCandle(t, price),
        history,
        botIds: new Set(),
        spreadPct: meta.vol > 0.0025 ? 0.00038 : 0.00022,
      };
      const last = history.at(-1)!;
      state.candle.o = state.candle.h = state.candle.l = state.candle.c = r2(price);
      state.candle.v = Math.round(120 + Math.random() * 400);
      this.states.set(meta.symbol, state);
      this.reseed(meta.symbol, state, true);
      // Align the engine's last price with the simulated mark.
      const book = eng.books.get(meta.symbol);
      if (book) book.last = Math.round(price * 100);
      void last;
    }
  }

  /** Remove the previous synthetic depth and rebuild it around the new mid. */
  private reseed(symbol: string, state: SimState, initial = false) {
    if (!initial) {
      for (const id of state.botIds) this.eng.cancel(id);
      state.botIds.clear();
    }
    const mid = Math.exp(state.logP);
    const half = Math.max(0.01, r2(mid * state.spreadPct));
    const gap = Math.max(0.02, r2(mid * 0.00045));
    const depth = 14;

    for (let i = 0; i < depth; i++) {
      for (const side of ['B', 'S'] as Side[]) {
        const raw = side === 'B' ? mid - half - i * gap : mid + half + i * gap;
        const price = Math.max(0.01, r2(raw));
        const base = 8 + Math.pow(Math.random(), 1.9) * (side === 'B' ? 420 : 380);
        const qty = Math.max(1, Math.round(base * (1 + i * 0.16)));
        const res = this.eng.place(symbol, side, 'LIMIT', price, qty);
        if (res.remaining > 0) state.botIds.add(res.id);
      }
    }
  }

  private rollCandle(state: SimState, ts: number, price: number) {
    const bucket = Math.floor(ts / CANDLE_MS) * CANDLE_MS;
    if (bucket !== state.candle.t) {
      state.history.push(state.candle);
      if (state.history.length > HISTORY_LEN) state.history.splice(0, state.history.length - HISTORY_LEN);
      state.candle = makeCandle(bucket, price);
    }
    const c = state.candle;
    c.h = Math.max(c.h, price);
    c.l = Math.min(c.l, price);
    c.c = price;
  }

  /** Advance one live tick. Returns the snapshots and resulting fills. */
  tick(dtMs = 250, ts = Date.now()): { snapshots: TickSnapshot[]; fills: FillEvent[] } {
    const snapshots: TickSnapshot[] = [];
    const fills: FillEvent[] = [];

    for (const state of this.states.values()) {
      const minutes = dtMs / CANDLE_MS;
      advance(state, minutes, state.candle.t !== Math.floor(ts / CANDLE_MS) * CANDLE_MS);
      const mark = Math.exp(state.logP);

      this.rollCandle(state, ts, mark);
      const c = state.candle;
      c.c = mark;

      this.reseed(state.meta.symbol, state);

      // Two-sided flow: a light lean against the last move, never one-way.
      const drag = clamp(-state.momentum * 0.45, -0.08, 0.08);
      const trades = 1 + (Math.random() < 0.55 ? 1 : 0);
      for (let i = 0; i < trades; i++) {
        const pBuy = clamp(0.5 + drag + (Math.random() - 0.5) * 0.1, 0.28, 0.72);
        const side: Side = Math.random() < pBuy ? 'B' : 'S';
        const qty = Math.max(1, Math.round(4 + Math.pow(Math.random(), 2.2) * (state.meta.vol > 0.0025 ? 320 : 190)));
        const res = this.eng.place(state.meta.symbol, side, 'MARKET', 0, qty);
        for (const f of res.fills) {
          this.tradeSeq++;
          fills.push({ id: f.id, symbol: f.symbol, price: f.price, qty: f.qty, side: f.side, ts: f.ts });
          c.v += f.qty;
        }
      }

      const open = state.history[0]?.o ?? mark;
      let high = mark;
      let low = mark;
      for (const h of state.history) {
        high = Math.max(high, h.h);
        low = Math.min(low, h.l);
      }
      const volume = state.history.reduce((sum, h) => sum + h.v, 0) + c.v;
      c.o = r2(c.o);
      c.h = r2(Math.max(c.h, c.o, c.c));
      c.l = r2(Math.min(c.l, c.o, c.c));
      c.c = r2(c.c);

      snapshots.push({
        symbol: state.meta.symbol,
        price: r2(mark),
        change: r2(mark - open),
        changePct: open ? ((mark - open) / open) * 100 : 0,
        open: r2(open),
        high: r2(high),
        low: r2(low),
        volume,
        candle: { ...c },
      });
    }

    return { snapshots, fills };
  }

  candles(symbol: string): Candle[] {
    const state = this.states.get(symbol.toUpperCase());
    if (!state) return [];
    return [...state.history, { ...state.candle }];
  }

  snapshot(symbol: string): TickSnapshot | null {
    const state = this.states.get(symbol.toUpperCase());
    if (!state) return null;
    const mark = Math.exp(state.logP);
    const open = state.history[0]?.o ?? mark;
    let high = mark;
    let low = mark;
    for (const h of state.history) {
      high = Math.max(high, h.h);
      low = Math.min(low, h.l);
    }
    return {
      symbol: state.meta.symbol,
      price: r2(mark),
      change: r2(mark - open),
      changePct: ((mark - open) / open) * 100,
      open: r2(open),
      high: r2(high),
      low: r2(low),
      volume: state.history.reduce((s, h) => s + h.v, 0) + state.candle.v,
      candle: { ...state.candle },
    };
  }

  spark(symbol: string, points = 40): number[] {
    const state = this.states.get(symbol.toUpperCase());
    if (!state) return [];
    const closes = [...state.history.map(c => c.c), state.candle.c];
    const step = Math.max(1, Math.floor(closes.length / points));
    const out: number[] = [];
    for (let i = 0; i < closes.length; i += step) out.push(closes[i]);
    if (out.at(-1) !== closes.at(-1)) out.push(closes.at(-1)!);
    return out.slice(-points);
  }

  reset(now = Date.now()) {
    this.states.clear();
    this.eng.books.clear();
    this.eng.index.clear();
    this.now = now;
    for (const meta of UNIVERSE) {
      const { history, logP, anchor } = buildHistory(meta, now);
      const price = Math.exp(logP);
      const t = Math.floor(now / CANDLE_MS) * CANDLE_MS;
      const state: SimState = {
        meta,
        logP,
        anchor,
        momentum: 0,
        trend: (Math.random() - 0.5) * 0.0005,
        candle: makeCandle(t, price),
        history,
        botIds: new Set(),
        spreadPct: meta.vol > 0.0025 ? 0.00038 : 0.00022,
      };
      state.candle.o = state.candle.h = state.candle.l = state.candle.c = r2(price);
      state.candle.v = Math.round(120 + Math.random() * 400);
      this.states.set(meta.symbol, state);
      this.reseed(meta.symbol, state, true);
      const book = this.eng.books.get(meta.symbol);
      if (book) book.last = Math.round(price * 100);
    }
  }
}
