import { Engine, Side } from './engine.js';

/* ============================================================================
 * Paper portfolio — cash, positions, resting orders and mark-to-market P&L.
 * All fills that touch a user order are booked here, whether the user crossed
 * the spread or a synthetic taker hit their resting limit.
 * ========================================================================== */

export interface Position {
  symbol: string;
  qty: number;
  avg: number;
  realized: number;
}

export interface OpenOrder {
  id: string;
  symbol: string;
  side: Side;
  type: 'LIMIT' | 'MARKET';
  price: number;
  qty: number;
  remaining: number;
  ts: number;
}

export interface EquityPoint {
  t: number;
  equity: number;
}

const START_CASH = 100_000;
const HISTORY_POINTS = 900;

export class Portfolio {
  cash = START_CASH;
  readonly startEquity = START_CASH;
  readonly positions = new Map<string, Position>();
  readonly orders = new Map<string, OpenOrder>();
  history: EquityPoint[] = [{ t: Date.now(), equity: START_CASH }];

  constructor(private eng: Engine) {
    eng.onMakerFill = fill => {
      const order = this.orders.get(fill.makerId);
      if (!order) return;
      this.applyFill(fill.makerSide, fill.trade.symbol, fill.trade.price, fill.trade.qty);
    };
  }

  private pos(symbol: string): Position {
    let p = this.positions.get(symbol);
    if (!p) {
      p = { symbol, qty: 0, avg: 0, realized: 0 };
      this.positions.set(symbol, p);
    }
    return p;
  }

  private applyFill(side: Side, symbol: string, price: number, qty: number) {
    const p = this.pos(symbol);
    if (side === 'B') {
      const cost = price * qty;
      this.cash -= cost;
      p.avg = p.qty + qty > 0 ? (p.avg * p.qty + cost) / (p.qty + qty) : 0;
      p.qty += qty;
    } else {
      const proceeds = price * qty;
      this.cash += proceeds;
      p.realized += (price - p.avg) * qty;
      p.qty = Math.max(0, p.qty - qty);
      if (p.qty === 0) p.avg = 0;
    }
  }

  /** Drop orders the engine no longer has resting (filled or cancelled). */
  sync() {
    for (const [id, order] of this.orders) {
      if (!this.eng.index.has(id)) {
        this.orders.delete(id);
      } else {
        order.remaining = this.eng.index.get(id)!.qty;
      }
    }
  }

  reservedCash(): number {
    let reserved = 0;
    for (const o of this.orders.values()) {
      if (o.side !== 'B') continue;
      const live = this.eng.index.get(o.id);
      if (live) reserved += live.qty * o.price;
    }
    return reserved;
  }

  reservedShares(symbol: string): number {
    let reserved = 0;
    for (const o of this.orders.values()) {
      if (o.side !== 'S' || o.symbol !== symbol) continue;
      const live = this.eng.index.get(o.id);
      if (live) reserved += live.qty;
    }
    return reserved;
  }

  availableShares(symbol: string): number {
    const p = this.positions.get(symbol);
    return Math.max(0, (p?.qty ?? 0) - this.reservedShares(symbol));
  }

  availableCash(): number {
    return this.cash - this.reservedCash();
  }

  private estimateMarketBuy(symbol: string, qty: number): number {
    const book = this.eng.books.get(symbol);
    if (!book) return Infinity;
    let remaining = qty;
    let cost = 0;
    for (const level of book.asks.top(25, false)) {
      if (remaining <= 0) break;
      const take = Math.min(remaining, level.total);
      cost += (level.price / 100) * take;
      remaining -= take;
    }
    if (remaining > 0) {
      const last = book.asks.top(1, false)[0]?.price ?? book.last;
      cost += (last / 100) * 1.01 * remaining;
    }
    return cost;
  }

  place(symbol: string, side: Side, type: 'LIMIT' | 'MARKET', price: number, qty: number) {
    const book = this.eng.books.get(symbol);
    if (!book) throw new Error(`Unknown symbol ${symbol}`);

    if (side === 'S') {
      const available = this.availableShares(symbol);
      if (qty > available) {
        throw new Error(`Not enough shares — you can sell ${available} ${symbol}`);
      }
    } else {
      const available = this.availableCash();
      const required = type === 'MARKET' ? this.estimateMarketBuy(symbol, qty) : price * qty;
      if (required > available) {
        throw new Error(
          `Insufficient buying power — need $${required.toFixed(2)}, available $${available.toFixed(2)}`
        );
      }
    }

    const result = this.eng.place(symbol, side, type, price, qty);

    for (const fill of result.fills) {
      this.applyFill(side, symbol, fill.price, fill.qty);
    }

    if (result.remaining > 0 && type === 'LIMIT') {
      this.orders.set(result.id, {
        id: result.id,
        symbol,
        side,
        type,
        price,
        qty,
        remaining: result.remaining,
        ts: Date.now(),
      });
    }

    let filledQty = 0;
    let notional = 0;
    for (const f of result.fills) {
      filledQty += f.qty;
      notional += f.price * f.qty;
    }

    return {
      ...result,
      avgPrice: filledQty ? notional / filledQty : price,
      filledQty,
      notional,
      portfolio: this.snapshot(this.livePrices()),
    };
  }

  cancel(id: string): string | null {
    const symbol = this.eng.cancel(id);
    this.orders.delete(id);
    return symbol;
  }

  livePrices(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [symbol, book] of this.eng.books) {
      out[symbol] = book.last ? book.last / 100 : 0;
    }
    return out;
  }

  equity(prices: Record<string, number>): number {
    let value = this.cash;
    for (const p of this.positions.values()) {
      if (p.qty > 0) value += p.qty * (prices[p.symbol] ?? p.avg);
    }
    return value;
  }

  sample(prices: Record<string, number>, ts = Date.now()) {
    const point = { t: ts, equity: this.equity(prices) };
    const last = this.history.at(-1);
    if (last && Math.floor(last.t / 1000) === Math.floor(ts / 1000)) {
      this.history[this.history.length - 1] = point;
    } else {
      this.history.push(point);
      if (this.history.length > HISTORY_POINTS) this.history.splice(0, this.history.length - HISTORY_POINTS);
    }
    return point;
  }

  snapshot(prices: Record<string, number>) {
    this.sync();
    const equity = this.equity(prices);
    const positions = [...this.positions.values()]
      .filter(p => p.qty > 0)
      .map(p => {
        const last = prices[p.symbol] ?? p.avg;
        const marketValue = p.qty * last;
        const costBasis = p.qty * p.avg;
        const unrealized = marketValue - costBasis;
        return {
          symbol: p.symbol,
          qty: p.qty,
          available: this.availableShares(p.symbol),
          avg: p.avg,
          last,
          marketValue,
          costBasis,
          unrealized,
          unrealizedPct: costBasis ? (unrealized / costBasis) * 100 : 0,
          realized: p.realized,
          allocation: equity ? (marketValue / equity) * 100 : 0,
        };
      })
      .sort((a, b) => b.marketValue - a.marketValue);

    const orders = [...this.orders.values()]
      .map(o => {
        const live = this.eng.index.get(o.id);
        return { ...o, remaining: live?.qty ?? 0 };
      })
      .filter(o => o.remaining > 0)
      .sort((a, b) => b.ts - a.ts);

    return {
      cash: this.cash,
      equity,
      buyingPower: this.availableCash(),
      startEquity: this.startEquity,
      totalPnl: equity - this.startEquity,
      totalPnlPct: ((equity - this.startEquity) / this.startEquity) * 100,
      realized: [...this.positions.values()].reduce((s, p) => s + p.realized, 0),
      positions,
      orders,
      history: this.history,
    };
  }

  reset(prices: Record<string, number>) {
    this.cash = START_CASH;
    this.positions.clear();
    this.orders.clear();
    this.history = [{ t: Date.now(), equity: START_CASH }];
    return this.snapshot(prices);
  }
}
