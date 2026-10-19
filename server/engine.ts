export type Side = 'B' | 'S';
export interface Trade { id: number; symbol: string; price: number; qty: number; side: Side; ts: number }
export interface OrderNode {
  id: string; symbol: string; side: Side; price: number; qty: number; ts: number;
  prev: OrderNode | null; next: OrderNode | null; level: PriceLevel | null;
}
export interface MakerFill {
  trade: Trade;
  makerId: string;
  makerSide: Side;
}

/* ---- Trie: O(K) prefix routing for ticker autocomplete ---- */
class TrieNode {
  c = new Map<string, TrieNode>();
  end = false;
}

export class Trie {
  private root = new TrieNode();

  insert(w: string) {
    let n = this.root;
    for (const ch of w.toUpperCase()) {
      if (!n.c.has(ch)) n.c.set(ch, new TrieNode());
      n = n.c.get(ch)!;
    }
    n.end = true;
  }

  search(prefix: string, limit = 8): string[] {
    let n = this.root;
    const p = prefix.toUpperCase();
    for (const ch of p) {
      const x = n.c.get(ch);
      if (!x) return [];
      n = x;
    }
    const out: string[] = [];
    const dfs = (t: TrieNode, s: string) => {
      if (out.length >= limit) return;
      if (t.end) out.push(s);
      [...t.c.keys()].sort().forEach(k => dfs(t.c.get(k)!, s + k));
    };
    dfs(n, p);
    return out;
  }
}

/* ---- Circular queue: O(1) trade log (fixed capacity) ---- */
export class CircularQueue<T> {
  private buf: (T | undefined)[];
  private head = 0;
  size = 0;

  constructor(private cap: number) {
    this.buf = new Array(cap);
  }

  push(x: T) {
    this.buf[(this.head + this.size) % this.cap] = x;
    if (this.size < this.cap) {
      this.size++;
    } else {
      this.head = (this.head + 1) % this.cap;
    }
  }

  recent(n: number): T[] {
    const out: T[] = [];
    for (let i = this.size - 1; i >= 0 && out.length < n; i--) {
      out.push(this.buf[(this.head + i) % this.cap]!);
    }
    return out;
  }
}

/* ---- Price level: doubly linked list FIFO ---- */
export class PriceLevel {
  head: OrderNode | null = null;
  tail: OrderNode | null = null;
  total = 0;
  count = 0;

  constructor(public price: number) {}

  push(o: OrderNode) {
    o.level = this;
    o.prev = this.tail;
    o.next = null;
    if (this.tail) this.tail.next = o;
    else this.head = o;
    this.tail = o;
    this.total += o.qty;
    this.count++;
  }

  unlink(o: OrderNode) {
    if (o.prev) o.prev.next = o.next;
    else this.head = o.next;
    if (o.next) o.next.prev = o.prev;
    else this.tail = o.prev;
    this.total -= o.qty;
    this.count--;
    o.prev = null;
    o.next = null;
    o.level = null;
  }
}

/* ---- Treap (self-balancing BST): O(log P) price index ---- */
class TNode {
  l: TNode | null = null;
  r: TNode | null = null;
  p = Math.random();
  constructor(public k: number, public v: PriceLevel) {}
}

export class PriceTree {
  root: TNode | null = null;

  private split(t: TNode | null, k: number): [TNode | null, TNode | null] {
    if (!t) return [null, null];
    if (t.k < k) {
      const [a, b] = this.split(t.r, k);
      t.r = a;
      return [t, b];
    } else {
      const [a, b] = this.split(t.l, k);
      t.l = b;
      return [a, t];
    }
  }

  private merge(a: TNode | null, b: TNode | null): TNode | null {
    if (!a) return b;
    if (!b) return a;
    if (a.p > b.p) {
      a.r = this.merge(a.r, b);
      return a;
    } else {
      b.l = this.merge(a, b.l);
      return b;
    }
  }

  get(k: number): PriceLevel | undefined {
    let t = this.root;
    while (t && t.k !== k) {
      t = k < t.k ? t.l : t.r;
    }
    return t?.v;
  }

  insert(k: number, v: PriceLevel) {
    this.remove(k);
    const [a, b] = this.split(this.root, k);
    this.root = this.merge(this.merge(a, new TNode(k, v)), b);
  }

  private deleteNode(t: TNode | null, k: number): TNode | null {
    if (!t) return null;
    if (k < t.k) {
      t.l = this.deleteNode(t.l, k);
      return t;
    } else if (k > t.k) {
      t.r = this.deleteNode(t.r, k);
      return t;
    } else {
      return this.merge(t.l, t.r);
    }
  }

  remove(k: number) {
    this.root = this.deleteNode(this.root, k);
  }

  best(max: boolean): PriceLevel | undefined {
    let t = this.root;
    if (!t) return undefined;
    while (max ? t.r : t.l) {
      t = (max ? t.r : t.l)!;
    }
    return t.v;
  }

  top(n: number, desc: boolean): PriceLevel[] {
    const out: PriceLevel[] = [];
    const walk = (t: TNode | null) => {
      if (!t || out.length >= n) return;
      walk(desc ? t.r : t.l);
      if (out.length < n) out.push(t.v);
      walk(desc ? t.l : t.r);
    };
    walk(this.root);
    return out;
  }
}

export class OrderBook {
  bids = new PriceTree();
  asks = new PriceTree();
  last = 0; // stored in cents

  constructor(public symbol: string) {}

  side(s: Side) {
    return s === 'B' ? this.bids : this.asks;
  }

  rest(o: OrderNode) {
    const t = this.side(o.side);
    let lv = t.get(o.price);
    if (!lv) {
      lv = new PriceLevel(o.price);
      t.insert(o.price, lv);
    }
    lv.push(o);
  }

  remove(o: OrderNode) {
    const lv = o.level;
    if (!lv) return;
    lv.unlink(o);
    if (lv.count === 0) {
      this.side(o.side).remove(lv.price);
    }
  }

  snapshot(depth = 15) {
    const format = (levels: PriceLevel[]) => {
      let cum = 0;
      return levels.map(l => ({
        price: l.price / 100,
        qty: l.total,
        cum: (cum += l.total),
      }));
    };
    return {
      symbol: this.symbol,
      last: this.last ? this.last / 100 : 0,
      bids: format(this.bids.top(depth, true)),
      asks: format(this.asks.top(depth, false)),
    };
  }
}

export class Engine {
  trie = new Trie();
  books = new Map<string, OrderBook>();
  index = new Map<string, OrderNode>();
  trades = new CircularQueue<Trade>(1000);
  /** Notified whenever a resting order is filled by an incoming order. */
  onMakerFill?: (fill: MakerFill) => void;
  private oid = 0;
  private tid = 0;

  addSymbol(s: string) {
    const sym = s.toUpperCase();
    this.trie.insert(sym);
    if (!this.books.has(sym)) {
      this.books.set(sym, new OrderBook(sym));
    }
  }

  place(symbol: string, side: Side, type: 'LIMIT' | 'MARKET', priceDollars: number, qty: number) {
    const sym = (symbol ?? '').toUpperCase();
    const book = this.books.get(sym);
    if (!book) throw new Error(`Unknown symbol ${symbol}`);
    if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a positive integer');
    if (side !== 'B' && side !== 'S') throw new Error('Invalid order side');
    if (type !== 'LIMIT' && type !== 'MARKET') throw new Error('Invalid order type');

    const priceCents = Math.round((Number(priceDollars) || 0) * 100);
    if (type === 'LIMIT' && (!Number.isFinite(priceDollars) || priceDollars <= 0 || priceCents <= 0)) {
      throw new Error('Limit price must be > 0');
    }

    const o: OrderNode = {
      id: `O${++this.oid}`,
      symbol: book.symbol,
      side,
      price: priceCents,
      qty,
      ts: Date.now(),
      prev: null,
      next: null,
      level: null,
    };

    const opp = book.side(side === 'B' ? 'S' : 'B');
    const fills: Trade[] = [];

    while (o.qty > 0) {
      // Buy aggressor hits lowest ask (opp.best(false)); Sell aggressor hits highest bid (opp.best(true))
      const lv = opp.best(side === 'S');
      if (!lv) break;
      if (type === 'LIMIT' && (side === 'B' ? lv.price > priceCents : lv.price < priceCents)) {
        break;
      }

      const maker = lv.head!;
      const fillQty = Math.min(o.qty, maker.qty);
      o.qty -= fillQty;
      maker.qty -= fillQty;
      lv.total -= fillQty;
      book.last = lv.price;

      const t: Trade = {
        id: ++this.tid,
        symbol: book.symbol,
        price: lv.price / 100, // execute at resting maker price in dollars
        qty: fillQty,
        side, // aggressor side
        ts: Date.now(),
      };

      this.trades.push(t);
      fills.push(t);
      this.onMakerFill?.({ trade: t, makerId: maker.id, makerSide: maker.side });

      if (maker.qty === 0) {
        book.remove(maker);
        this.index.delete(maker.id);
      }
    }

    if (o.qty > 0 && type === 'LIMIT') {
      book.rest(o);
      this.index.set(o.id, o);
    }

    const status: 'OPEN' | 'PARTIAL' | 'FILLED' | 'CANCELLED_REMAINDER' =
      o.qty === 0
        ? 'FILLED'
        : type === 'LIMIT'
        ? fills.length > 0
          ? 'PARTIAL'
          : 'OPEN'
        : 'CANCELLED_REMAINDER';

    return {
      id: o.id,
      remaining: o.qty,
      status,
      fills,
    };
  }

  cancel(id: string): string | null {
    const o = this.index.get(id);
    if (!o) return null;
    const book = this.books.get(o.symbol);
    if (book) {
      book.remove(o);
    }
    this.index.delete(id);
    return o.symbol;
  }
}
