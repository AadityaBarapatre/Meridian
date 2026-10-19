from __future__ import annotations
import math
import random
import time
from typing import Optional, Callable, Any
from dataclasses import dataclass

Side = str  # 'B' or 'S'

@dataclass
class Trade:
    id: int
    symbol: str
    price: float
    qty: int
    side: Side
    ts: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "price": self.price,
            "qty": self.qty,
            "side": self.side,
            "ts": self.ts,
        }

@dataclass
class MakerFill:
    trade: Trade
    maker_id: str
    maker_side: Side

class OrderNode:
    __slots__ = ('id', 'symbol', 'side', 'price', 'qty', 'ts', 'prev', 'next', 'level')

    def __init__(self, order_id: str, symbol: str, side: Side, price: int, qty: int, ts: int):
        self.id = order_id
        self.symbol = symbol
        self.side = side
        self.price = price  # integer cents
        self.qty = qty
        self.ts = ts
        self.prev: Optional[OrderNode] = None
        self.next: Optional[OrderNode] = None
        self.level: Optional[PriceLevel] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "symbol": self.symbol,
            "side": self.side,
            "price": self.price / 100.0,
            "qty": self.qty,
            "ts": self.ts,
        }

# ---- Trie: O(K) prefix routing for ticker autocomplete ----
class TrieNode:
    __slots__ = ('c', 'end')

    def __init__(self):
        self.c: dict[str, TrieNode] = {}
        self.end = False

class Trie:
    def __init__(self):
        self.root = TrieNode()

    def insert(self, w: str) -> None:
        n = self.root
        for ch in w.upper():
            if ch not in n.c:
                n.c[ch] = TrieNode()
            n = n.c[ch]
        n.end = True

    def search(self, prefix: str, limit: int = 8) -> list[str]:
        n = self.root
        p = prefix.upper()
        for ch in p:
            if ch not in n.c:
                return []
            n = n.c[ch]

        out: list[str] = []

        def dfs(t: TrieNode, s: str):
            if len(out) >= limit:
                return
            if t.end:
                out.append(s)
            for k in sorted(t.c.keys()):
                dfs(t.c[k], s + k)
                if len(out) >= limit:
                    return

        dfs(n, p)
        return out

# ---- Circular queue: O(1) trade log (fixed capacity ring buffer) ----
class CircularQueue:
    def __init__(self, cap: int):
        self.cap = cap
        self.buf: list[Optional[Any]] = [None] * cap
        self.head = 0
        self.size = 0

    def push(self, x: Any) -> None:
        self.buf[(self.head + self.size) % self.cap] = x
        if self.size < self.cap:
            self.size += 1
        else:
            self.head = (self.head + 1) % self.cap

    def recent(self, n: int) -> list[Any]:
        out = []
        for i in range(self.size - 1, -1, -1):
            if len(out) >= n:
                break
            item = self.buf[(self.head + i) % self.cap]
            if item is not None:
                out.append(item)
        return out

# ---- Price level: doubly linked list FIFO ----
class PriceLevel:
    __slots__ = ('price', 'head', 'tail', 'total', 'count')

    def __init__(self, price: int):
        self.price = price  # integer cents
        self.head: Optional[OrderNode] = None
        self.tail: Optional[OrderNode] = None
        self.total = 0
        self.count = 0

    def push(self, o: OrderNode) -> None:
        o.level = self
        o.prev = self.tail
        o.next = None
        if self.tail:
            self.tail.next = o
        else:
            self.head = o
        self.tail = o
        self.total += o.qty
        self.count += 1

    def unlink(self, o: OrderNode) -> None:
        if o.prev:
            o.prev.next = o.next
        else:
            self.head = o.next
        if o.next:
            o.next.prev = o.prev
        else:
            self.tail = o.prev
        self.total -= o.qty
        self.count -= 1
        o.prev = None
        o.next = None
        o.level = None

# ---- Treap (self-balancing BST): O(log P) price index ----
class TNode:
    __slots__ = ('k', 'v', 'p', 'l', 'r')

    def __init__(self, k: int, v: PriceLevel):
        self.k = k
        self.v = v
        self.p = random.random()
        self.l: Optional[TNode] = None
        self.r: Optional[TNode] = None

class PriceTree:
    def __init__(self):
        self.root: Optional[TNode] = None

    def _split(self, t: Optional[TNode], k: int) -> tuple[Optional[TNode], Optional[TNode]]:
        if not t:
            return None, None
        if t.k < k:
            a, b = self._split(t.r, k)
            t.r = a
            return t, b
        else:
            a, b = self._split(t.l, k)
            t.l = b
            return a, t

    def _merge(self, a: Optional[TNode], b: Optional[TNode]) -> Optional[TNode]:
        if not a: return b
        if not b: return a
        if a.p > b.p:
            a.r = self._merge(a.r, b)
            return a
        else:
            b.l = self._merge(a, b.l)
            return b

    def get(self, k: int) -> Optional[PriceLevel]:
        t = self.root
        while t and t.k != k:
            t = t.l if k < t.k else t.r
        return t.v if t else None

    def insert(self, k: int, v: PriceLevel) -> None:
        self.remove(k)
        a, b = self._split(self.root, k)
        self.root = self._merge(self._merge(a, TNode(k, v)), b)

    def _delete_node(self, t: Optional[TNode], k: int) -> Optional[TNode]:
        if not t: return None
        if k < t.k:
            t.l = self._delete_node(t.l, k)
            return t
        elif k > t.k:
            t.r = self._delete_node(t.r, k)
            return t
        else:
            return self._merge(t.l, t.r)

    def remove(self, k: int) -> None:
        self.root = self._delete_node(self.root, k)

    def best(self, is_max: bool) -> Optional[PriceLevel]:
        t = self.root
        if not t: return None
        while (t.r if is_max else t.l):
            t = (t.r if is_max else t.l)
        return t.v

    def top(self, n: int, desc: bool) -> list[PriceLevel]:
        out: list[PriceLevel] = []

        def walk(t: Optional[TNode]):
            if not t or len(out) >= n: return
            walk(t.r if desc else t.l)
            if len(out) < n:
                out.append(t.v)
            walk(t.l if desc else t.r)

        walk(self.root)
        return out

class OrderBook:
    def __init__(self, symbol: str):
        self.symbol = symbol.upper()
        self.bids = PriceTree()
        self.asks = PriceTree()
        self.last = 0  # stored in cents

    def side(self, s: Side) -> PriceTree:
        return self.bids if s == 'B' else self.asks

    def rest(self, o: OrderNode) -> None:
        t = self.side(o.side)
        lv = t.get(o.price)
        if not lv:
            lv = PriceLevel(o.price)
            t.insert(o.price, lv)
        lv.push(o)

    def remove(self, o: OrderNode) -> None:
        lv = o.level
        if not lv: return
        lv.unlink(o)
        if lv.count == 0:
            self.side(o.side).remove(lv.price)

    def snapshot(self, depth: int = 15) -> dict[str, Any]:
        def format_levels(levels: list[PriceLevel]):
            out = []
            cum = 0
            for l in levels:
                cum += l.total
                out.append({
                    "price": l.price / 100.0,
                    "qty": l.total,
                    "cum": cum,
                })
            return out

        return {
            "symbol": self.symbol,
            "last": (self.last / 100.0) if self.last else 0,
            "bids": format_levels(self.bids.top(depth, True)),
            "asks": format_levels(self.asks.top(depth, False)),
        }

class Engine:
    def __init__(self):
        self.trie = Trie()
        self.books: dict[str, OrderBook] = {}
        self.index: dict[str, OrderNode] = {}
        self.trades = CircularQueue(1000)
        self.on_maker_fill: Optional[Callable[[MakerFill], None]] = None
        self._oid = 0
        self._tid = 0

    def add_symbol(self, s: str) -> None:
        sym = s.upper()
        self.trie.insert(sym)
        if sym not in self.books:
            self.books[sym] = OrderBook(sym)

    def place(self, symbol: str, side: Side, order_type: str, price_dollars: float, qty: int) -> dict[str, Any]:
        sym = (symbol or '').upper()
        book = self.books.get(sym)
        if not book:
            raise ValueError(f"Unknown symbol {symbol}")
        if not isinstance(qty, int) or qty <= 0:
            raise ValueError("Quantity must be a positive integer")
        if side not in ('B', 'S'):
            raise ValueError("Invalid order side")
        if order_type not in ('LIMIT', 'MARKET'):
            raise ValueError("Invalid order type")

        price_cents = round(float(price_dollars or 0) * 100)
        if order_type == 'LIMIT' and (not math.isfinite(price_dollars) or price_dollars <= 0 or price_cents <= 0):
            raise ValueError("Limit price must be > 0")

        self._oid += 1
        now_ms = int(time.time() * 1000)
        o = OrderNode(f"O{self._oid}", book.symbol, side, price_cents, qty, now_ms)

        opp = book.side('S' if side == 'B' else 'B')
        fills: list[Trade] = []

        while o.qty > 0:
            # Buy aggressor hits lowest ask (is_max=False); Sell aggressor hits highest bid (is_max=True)
            lv = opp.best(side == 'S')
            if not lv:
                break
            if order_type == 'LIMIT' and (lv.price > price_cents if side == 'B' else lv.price < price_cents):
                break

            maker = lv.head
            if not maker:
                break

            fill_qty = min(o.qty, maker.qty)
            o.qty -= fill_qty
            maker.qty -= fill_qty
            lv.total -= fill_qty
            book.last = lv.price

            self._tid += 1
            t = Trade(
                id=self._tid,
                symbol=book.symbol,
                price=lv.price / 100.0,
                qty=fill_qty,
                side=side,
                ts=int(time.time() * 1000),
            )

            self.trades.push(t)
            fills.append(t)

            if self.on_maker_fill:
                self.on_maker_fill(MakerFill(trade=t, maker_id=maker.id, maker_side=maker.side))

            if maker.qty == 0:
                book.remove(maker)
                self.index.pop(maker.id, None)

        if o.qty > 0 and order_type == 'LIMIT':
            book.rest(o)
            self.index[o.id] = o

        if o.qty == 0:
            status = 'FILLED'
        elif order_type == 'LIMIT':
            status = 'PARTIAL' if len(fills) > 0 else 'OPEN'
        else:
            status = 'CANCELLED_REMAINDER'

        return {
            "id": o.id,
            "remaining": o.qty,
            "status": status,
            "fills": fills,
        }

    def cancel(self, order_id: str) -> Optional[str]:
        o = self.index.get(order_id)
        if not o:
            return None
        book = self.books.get(o.symbol)
        if book:
            book.remove(o)
        self.index.pop(order_id, None)
        return o.symbol
