from __future__ import annotations
import math
import random
import time
from typing import Optional, Any
from dataclasses import dataclass, field
from python_server.engine import Engine, Side

CANDLE_MS = 60_000
HISTORY_LEN = 480  # 8 hours of one-minute candles
TICK_SUBSTEPS = 6

def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))

def r2(v: float) -> float:
    return round(v * 100) / 100.0

@dataclass
class Candle:
    t: int
    o: float
    h: float
    l: float
    c: float
    v: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "t": self.t,
            "o": self.o,
            "h": self.h,
            "l": self.l,
            "c": self.c,
            "v": self.v,
        }

@dataclass
class SymbolMeta:
    symbol: str
    name: str
    sector: str
    base: float
    vol: float
    drift: float

UNIVERSE: list[SymbolMeta] = [
    SymbolMeta(symbol='AAPL', name='Apple Inc.', sector='Technology', base=191.24, vol=0.0016, drift=0.00004),
    SymbolMeta(symbol='MSFT', name='Microsoft Corp.', sector='Technology', base=421.66, vol=0.0015, drift=0.00005),
    SymbolMeta(symbol='NVDA', name='NVIDIA Corp.', sector='Semiconductors', base=894.5, vol=0.0031, drift=0.00009),
    SymbolMeta(symbol='TSLA', name='Tesla Inc.', sector='Automotive', base=176.88, vol=0.0034, drift=-0.00003),
    SymbolMeta(symbol='AMZN', name='Amazon.com Inc.', sector='Consumer', base=182.34, vol=0.0019, drift=0.00005),
    SymbolMeta(symbol='GOOG', name='Alphabet Inc.', sector='Communication', base=152.11, vol=0.0017, drift=0.00003),
    SymbolMeta(symbol='META', name='Meta Platforms', sector='Communication', base=482.73, vol=0.0022, drift=0.00006),
    SymbolMeta(symbol='NFLX', name='Netflix Inc.', sector='Entertainment', base=621.4, vol=0.0024, drift=0.00002),
]

class SimState:
    def __init__(self, meta: SymbolMeta, log_p: float, anchor: float, trend: float, candle: Candle, history: list[Candle]):
        self.meta = meta
        self.log_p = log_p
        self.anchor = anchor
        self.momentum = 0.0
        self.trend = trend
        self.candle = candle
        self.history = history
        self.bot_ids: set[str] = set()
        self.spread_pct = 0.00038 if meta.vol > 0.0025 else 0.00022

def make_candle(t: int, price: float) -> Candle:
    p = r2(price)
    return Candle(t=t, o=p, h=p, l=p, c=p, v=0)

def advance(state: SimState, minutes: float, drift_step: bool = False):
    meta = state.meta
    theta = 0.024  # pull toward anchor per minute
    if drift_step:
        state.anchor += meta.drift * minutes + 0.0011 * math.sqrt(minutes) * random.gauss(0, 1)
        if random.random() < minutes / 42.0:
            state.trend = -state.trend

    shock = 0.0
    if random.random() < 0.004:
        sign = -1.0 if random.random() < 0.5 else 1.0
        shock = sign * (0.0025 + random.random() * 0.006)

    state.log_p += (
        theta * (state.anchor - state.log_p) * minutes
        + meta.vol * math.sqrt(minutes) * random.gauss(0, 1)
        + shock
        + state.trend * minutes
    )
    state.momentum = state.momentum * (1.0 - 0.22 * minutes) + 0.24 * math.sqrt(minutes) * random.gauss(0, 1)

def build_history(meta: SymbolMeta, now: int) -> tuple[list[Candle], float, float]:
    log_p = math.log(meta.base * (0.985 + random.random() * 0.03))
    anchor = log_p
    trend = (random.random() - 0.5) * 0.0005
    end_t = (now // CANDLE_MS) * CANDLE_MS
    start_t = end_t - HISTORY_LEN * CANDLE_MS
    history: list[Candle] = []

    state = SimState(
        meta=meta,
        log_p=log_p,
        anchor=anchor,
        trend=trend,
        candle=make_candle(start_t, math.exp(log_p)),
        history=[],
    )

    for i in range(HISTORY_LEN):
        t = start_t + i * CANDLE_MS
        open_px = math.exp(state.log_p)
        high = open_px
        low = open_px
        close = open_px
        volume = 0.0

        for s in range(TICK_SUBSTEPS):
            advance(state, 1.0 / TICK_SUBSTEPS, s == 0)
            px = math.exp(state.log_p)
            high = max(high, px)
            low = min(low, px)
            close = px
            volume += 40 + random.random() * 900

        log_p = state.log_p
        anchor = state.anchor
        o = r2(open_px)
        c = r2(close)
        candle = Candle(
            t=t,
            o=o,
            h=r2(max(high, o, c)),
            l=r2(min(low, o, c)),
            c=c,
            v=round(volume),
        )
        history.append(candle)

    return history, log_p, anchor

class MarketSim:
    def __init__(self, eng: Engine, now: Optional[int] = None):
        self.eng = eng
        self.now = now if now is not None else int(time.time() * 1000)
        self.states: dict[str, SimState] = {}
        self.trade_seq = 0

        for meta in UNIVERSE:
            eng.add_symbol(meta.symbol)
            history, log_p, anchor = build_history(meta, self.now)
            price = math.exp(log_p)
            t = (self.now // CANDLE_MS) * CANDLE_MS
            candle = make_candle(t, price)
            candle.v = round(120 + random.random() * 400)

            state = SimState(
                meta=meta,
                log_p=log_p,
                anchor=anchor,
                trend=(random.random() - 0.5) * 0.0005,
                candle=candle,
                history=history,
            )
            self.states[meta.symbol] = state
            self.reseed(meta.symbol, state, initial=True)

            book = eng.books.get(meta.symbol)
            if book:
                book.last = round(price * 100)

    def reseed(self, symbol: str, state: SimState, initial: bool = False):
        if not initial:
            for oid in state.bot_ids:
                self.eng.cancel(oid)
            state.bot_ids.clear()

        mid = math.exp(state.log_p)
        half = max(0.01, r2(mid * state.spread_pct))
        gap = max(0.02, r2(mid * 0.00045))
        depth = 14

        for i in range(depth):
            for side in ('B', 'S'):
                raw = mid - half - i * gap if side == 'B' else mid + half + i * gap
                price = max(0.01, r2(raw))
                base = 8 + (random.random() ** 1.9) * (420 if side == 'B' else 380)
                qty = max(1, round(base * (1 + i * 0.16)))
                res = self.eng.place(symbol, side, 'LIMIT', price, qty)
                if res['remaining'] > 0:
                    state.bot_ids.add(res['id'])

    def roll_candle(self, state: SimState, ts: int, price: float):
        bucket = (ts // CANDLE_MS) * CANDLE_MS
        if bucket != state.candle.t:
            state.history.append(state.candle)
            if len(state.history) > HISTORY_LEN:
                state.history = state.history[-HISTORY_LEN:]
            state.candle = make_candle(bucket, price)

        c = state.candle
        c.h = max(c.h, price)
        c.l = min(c.l, price)
        c.c = price

    def tick(self, dt_ms: int = 250, ts: Optional[int] = None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        if ts is None:
            ts = int(time.time() * 1000)

        snapshots: list[dict[str, Any]] = []
        fills: list[dict[str, Any]] = []

        for state in self.states.values():
            minutes = dt_ms / CANDLE_MS
            is_new_bucket = state.candle.t != (ts // CANDLE_MS) * CANDLE_MS
            advance(state, minutes, is_new_bucket)
            mark = math.exp(state.log_p)

            self.roll_candle(state, ts, mark)
            c = state.candle
            c.c = mark

            self.reseed(state.meta.symbol, state)

            drag = clamp(-state.momentum * 0.45, -0.08, 0.08)
            trade_count = 1 + (1 if random.random() < 0.55 else 0)
            for _ in range(trade_count):
                p_buy = clamp(0.5 + drag + (random.random() - 0.5) * 0.1, 0.28, 0.72)
                side: Side = 'B' if random.random() < p_buy else 'S'
                vol_boost = 320 if state.meta.vol > 0.0025 else 190
                qty = max(1, round(4 + (random.random() ** 2.2) * vol_boost))
                res = self.eng.place(state.meta.symbol, side, 'MARKET', 0, qty)
                for f in res['fills']:
                    self.trade_seq += 1
                    trade_dict = f.to_dict()
                    fills.append(trade_dict)
                    c.v += f.qty

            open_px = state.history[0].o if state.history else mark
            high = mark
            low = mark
            for h in state.history:
                high = max(high, h.h)
                low = min(low, h.l)

            volume = sum(h.v for h in state.history) + c.v
            c.o = r2(c.o)
            c.h = r2(max(c.h, c.o, c.c))
            c.l = r2(min(c.l, c.o, c.c))
            c.c = r2(c.c)

            change = r2(mark - open_px)
            change_pct = ((mark - open_px) / open_px) * 100.0 if open_px else 0.0

            snapshots.append({
                "symbol": state.meta.symbol,
                "price": r2(mark),
                "change": change,
                "changePct": change_pct,
                "open": r2(open_px),
                "high": r2(high),
                "low": r2(low),
                "volume": volume,
                "candle": c.to_dict(),
            })

        return snapshots, fills

    def candles(self, symbol: str) -> list[dict[str, Any]]:
        state = self.states.get(symbol.upper())
        if not state:
            return []
        return [c.to_dict() for c in state.history] + [state.candle.to_dict()]

    def snapshot(self, symbol: str) -> Optional[dict[str, Any]]:
        state = self.states.get(symbol.upper())
        if not state:
            return None
        mark = math.exp(state.log_p)
        open_px = state.history[0].o if state.history else mark
        high = mark
        low = mark
        for h in state.history:
            high = max(high, h.h)
            low = min(low, h.l)

        volume = sum(h.v for h in state.history) + state.candle.v
        return {
            "symbol": state.meta.symbol,
            "price": r2(mark),
            "change": r2(mark - open_px),
            "changePct": ((mark - open_px) / open_px) * 100.0 if open_px else 0.0,
            "open": r2(open_px),
            "high": r2(high),
            "low": r2(low),
            "volume": volume,
            "candle": state.candle.to_dict(),
        }

    def spark(self, symbol: str, points: int = 40) -> list[float]:
        state = self.states.get(symbol.upper())
        if not state:
            return []
        closes = [c.c for c in state.history] + [state.candle.c]
        step = max(1, len(closes) // points)
        out = [closes[i] for i in range(0, len(closes), step)]
        if out[-1] != closes[-1]:
            out.append(closes[-1])
        return out[-points:]

    def reset(self, now: Optional[int] = None):
        self.states.clear()
        self.eng.books.clear()
        self.eng.index.clear()
        self.now = now if now is not None else int(time.time() * 1000)

        for meta in UNIVERSE:
            history, log_p, anchor = build_history(meta, self.now)
            price = math.exp(log_p)
            t = (self.now // CANDLE_MS) * CANDLE_MS
            candle = make_candle(t, price)
            candle.v = round(120 + random.random() * 400)

            state = SimState(
                meta=meta,
                log_p=log_p,
                anchor=anchor,
                trend=(random.random() - 0.5) * 0.0005,
                candle=candle,
                history=history,
            )
            self.states[meta.symbol] = state
            self.reseed(meta.symbol, state, initial=True)

            book = self.eng.books.get(meta.symbol)
            if book:
                book.last = round(price * 100)
