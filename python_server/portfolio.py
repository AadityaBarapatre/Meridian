from __future__ import annotations
import math
import time
from typing import Optional, Any
from dataclasses import dataclass
from python_server.engine import Engine, Side, MakerFill

START_CASH = 100_000.0
HISTORY_POINTS = 900

@dataclass
class Position:
    symbol: str
    qty: int = 0
    avg: float = 0.0
    realized: float = 0.0

@dataclass
class OpenOrder:
    id: str
    symbol: str
    side: Side
    type: str  # 'LIMIT' | 'MARKET'
    price: float
    qty: int
    remaining: int
    ts: int

@dataclass
class EquityPoint:
    t: int
    equity: float

class Portfolio:
    def __init__(self, eng: Engine):
        self.eng = eng
        self.cash = START_CASH
        self.start_equity = START_CASH
        self.positions: dict[str, Position] = {}
        self.orders: dict[str, OpenOrder] = {}
        self.history: list[EquityPoint] = [EquityPoint(t=int(time.time() * 1000), equity=START_CASH)]

        def _on_fill(fill: MakerFill):
            order = self.orders.get(fill.maker_id)
            if not order:
                return
            self._apply_fill(fill.maker_side, fill.trade.symbol, fill.trade.price, fill.trade.qty)

        self.eng.on_maker_fill = _on_fill

    def _pos(self, symbol: str) -> Position:
        p = self.positions.get(symbol)
        if not p:
            p = Position(symbol=symbol)
            self.positions[symbol] = p
        return p

    def _apply_fill(self, side: Side, symbol: str, price: float, qty: int) -> None:
        p = self._pos(symbol)
        if side == 'B':
            cost = price * qty
            self.cash -= cost
            if p.qty + qty > 0:
                p.avg = (p.avg * p.qty + cost) / (p.qty + qty)
            else:
                p.avg = 0.0
            p.qty += qty
        else:
            proceeds = price * qty
            self.cash += proceeds
            p.realized += (price - p.avg) * qty
            p.qty = max(0, p.qty - qty)
            if p.qty == 0:
                p.avg = 0.0

    def sync(self) -> None:
        to_delete = []
        for oid, order in self.orders.items():
            live = self.eng.index.get(oid)
            if not live:
                to_delete.append(oid)
            else:
                order.remaining = live.qty
        for oid in to_delete:
            del self.orders[oid]

    def reserved_cash(self) -> float:
        reserved = 0.0
        for o in self.orders.values():
            if o.side != 'B':
                continue
            live = self.eng.index.get(o.id)
            if live:
                reserved += live.qty * o.price
        return reserved

    def reserved_shares(self, symbol: str) -> int:
        reserved = 0
        for o in self.orders.values():
            if o.side != 'S' or o.symbol != symbol:
                continue
            live = self.eng.index.get(o.id)
            if live:
                reserved += live.qty
        return reserved

    def available_shares(self, symbol: str) -> int:
        p = self.positions.get(symbol)
        qty = p.qty if p else 0
        return max(0, qty - self.reserved_shares(symbol))

    def available_cash(self) -> float:
        return self.cash - self.reserved_cash()

    def estimate_market_buy(self, symbol: str, qty: int) -> float:
        book = self.eng.books.get(symbol)
        if not book:
            return float('inf')
        remaining = qty
        cost = 0.0
        for level in book.asks.top(25, False):
            if remaining <= 0:
                break
            take = min(remaining, level.total)
            cost += (level.price / 100.0) * take
            remaining -= take

        if remaining > 0:
            top_ask = book.asks.top(1, False)
            last_price = top_ask[0].price if top_ask else book.last
            cost += (last_price / 100.0) * 1.01 * remaining
        return cost

    def place(self, symbol: str, side: Side, order_type: str, price: float, qty: int) -> dict[str, Any]:
        book = self.eng.books.get(symbol)
        if not book:
            raise ValueError(f"Unknown symbol {symbol}")

        if side == 'S':
            available = self.available_shares(symbol)
            if qty > available:
                raise ValueError(f"Not enough shares — you can sell {available} {symbol}")
        else:
            available = self.available_cash()
            required = self.estimate_market_buy(symbol, qty) if order_type == 'MARKET' else price * qty
            if required > available:
                raise ValueError(
                    f"Insufficient buying power — need ${required:.2f}, available ${available:.2f}"
                )

        result = self.eng.place(symbol, side, order_type, price, qty)

        for fill in result['fills']:
            self._apply_fill(side, symbol, fill.price, fill.qty)

        if result['remaining'] > 0 and order_type == 'LIMIT':
            self.orders[result['id']] = OpenOrder(
                id=result['id'],
                symbol=symbol,
                side=side,
                type=order_type,
                price=price,
                qty=qty,
                remaining=result['remaining'],
                ts=int(time.time() * 1000),
            )

        filled_qty = sum(f.qty for f in result['fills'])
        notional = sum(f.price * f.qty for f in result['fills'])

        return {
            **result,
            "avgPrice": (notional / filled_qty) if filled_qty else price,
            "filledQty": filled_qty,
            "notional": notional,
            "portfolio": self.snapshot(self.live_prices()),
        }

    def cancel(self, order_id: str) -> Optional[str]:
        symbol = self.eng.cancel(order_id)
        self.orders.pop(order_id, None)
        return symbol

    def live_prices(self) -> dict[str, float]:
        out = {}
        for sym, book in self.eng.books.items():
            out[sym] = (book.last / 100.0) if book.last else 0.0
        return out

    def equity(self, prices: dict[str, float]) -> float:
        val = self.cash
        for p in self.positions.values():
            if p.qty > 0:
                val += p.qty * prices.get(p.symbol, p.avg)
        return val

    def sample(self, prices: dict[str, float], ts: Optional[int] = None) -> dict[str, Any]:
        if ts is None:
            ts = int(time.time() * 1000)
        point = EquityPoint(t=ts, equity=self.equity(prices))
        if self.history and (self.history[-1].t // 1000) == (ts // 1000):
            self.history[-1] = point
        else:
            self.history.append(point)
            if len(self.history) > HISTORY_POINTS:
                self.history = self.history[-HISTORY_POINTS:]
        return {"t": point.t, "equity": point.equity}

    def snapshot(self, prices: dict[str, float]) -> dict[str, Any]:
        self.sync()
        eq = self.equity(prices)

        positions_list = []
        for p in self.positions.values():
            if p.qty <= 0:
                continue
            last = prices.get(p.symbol, p.avg)
            market_val = p.qty * last
            cost_basis = p.qty * p.avg
            unrealized = market_val - cost_basis
            unrealized_pct = (unrealized / cost_basis * 100.0) if cost_basis else 0.0
            allocation = (market_val / eq * 100.0) if eq else 0.0

            positions_list.append({
                "symbol": p.symbol,
                "qty": p.qty,
                "available": self.available_shares(p.symbol),
                "avg": p.avg,
                "last": last,
                "marketValue": market_val,
                "costBasis": cost_basis,
                "unrealized": unrealized,
                "unrealizedPct": unrealized_pct,
                "realized": p.realized,
                "allocation": allocation,
            })
        positions_list.sort(key=lambda x: x["marketValue"], reverse=True)

        orders_list = []
        for o in self.orders.values():
            live = self.eng.index.get(o.id)
            rem = live.qty if live else 0
            if rem > 0:
                orders_list.append({
                    "id": o.id,
                    "symbol": o.symbol,
                    "side": o.side,
                    "type": o.type,
                    "price": o.price,
                    "qty": o.qty,
                    "remaining": rem,
                    "ts": o.ts,
                })
        orders_list.sort(key=lambda x: x["ts"], reverse=True)

        tot_pnl = eq - self.start_equity
        tot_pnl_pct = (tot_pnl / self.start_equity * 100.0) if self.start_equity else 0.0
        realized_total = sum(p.realized for p in self.positions.values())

        return {
            "cash": self.cash,
            "equity": eq,
            "buyingPower": self.available_cash(),
            "startEquity": self.start_equity,
            "totalPnl": tot_pnl,
            "totalPnlPct": tot_pnl_pct,
            "realized": realized_total,
            "positions": positions_list,
            "orders": orders_list,
            "history": [{"t": pt.t, "equity": pt.equity} for pt in self.history],
        }

    def reset(self, prices: dict[str, float]) -> dict[str, Any]:
        self.cash = START_CASH
        self.positions.clear()
        self.orders.clear()
        self.history = [EquityPoint(t=int(time.time() * 1000), equity=START_CASH)]
        return self.snapshot(prices)
