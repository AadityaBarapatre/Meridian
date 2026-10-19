import os
import time
import json
import asyncio
from typing import Optional, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from python_server.engine import Engine, Side
from python_server.market import MarketSim, UNIVERSE
from python_server.portfolio import Portfolio

eng = Engine()
sim = MarketSim(eng)
portfolio = Portfolio(eng)

# Track active WebSocket connections and their subscribed symbol
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict[WebSocket, str] = {}

    async def connect(self, ws: WebSocket, default_symbol: str = "AAPL"):
        await ws.accept()
        self.active_connections[ws] = default_symbol.upper()

    def disconnect(self, ws: WebSocket):
        self.active_connections.pop(ws, None)

    def set_symbol(self, ws: WebSocket, symbol: str):
        if ws in self.active_connections:
            self.active_connections[ws] = symbol.upper()

    def get_symbol(self, ws: WebSocket) -> str:
        return self.active_connections.get(ws, "AAPL")

    async def broadcast(self, message: dict[str, Any]):
        payload = json.dumps(message)
        dead = []
        for ws in self.active_connections:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send_to(self, ws: WebSocket, message: dict[str, Any]):
        try:
            await ws.send_text(json.dumps(message))
        except Exception:
            self.disconnect(ws)

manager = ConnectionManager()

def book_snapshot(symbol: str) -> Optional[dict[str, Any]]:
    book = eng.books.get(symbol.upper())
    return book.snapshot() if book else None

async def broadcast_portfolio():
    await manager.broadcast({
        "type": "portfolio",
        "portfolio": portfolio.snapshot(portfolio.live_prices()),
    })

# Background market loop running at 250ms interval
async def market_loop():
    last_portfolio_at = 0.0
    tick_ms = 250

    while True:
        try:
            await asyncio.sleep(tick_ms / 1000.0)
            snapshots, fills = sim.tick(tick_ms)

            if fills:
                await manager.broadcast({"type": "trades", "trades": fills})

            await manager.broadcast({
                "type": "ticks",
                "ts": int(time.time() * 1000),
                "ticks": snapshots,
            })

            # Send depth for each client's selected symbol
            book_cache: dict[str, Any] = {}
            for ws, sym in list(manager.active_connections.items()):
                if sym not in book_cache:
                    book_cache[sym] = book_snapshot(sym)
                snap = book_cache[sym]
                if snap:
                    await manager.send_to(ws, {"type": "book", **snap})

            now = time.time()
            portfolio.sync()
            if now - last_portfolio_at >= 1.0:
                last_portfolio_at = now
                portfolio.sample(portfolio.live_prices(), int(now * 1000))
                await broadcast_portfolio()

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[market loop error] {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(market_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass

app = FastAPI(lifespan=lifespan)

# Allow CORS for development (e.g. Vite dev server on :5173)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------- REST API ----------------------------

class OrderRequest(BaseModel):
    symbol: str
    side: str
    type: str
    price: float
    qty: int

@app.get("/api/bootstrap")
def get_bootstrap():
    symbols = []
    for meta in UNIVERSE:
        tick = sim.snapshot(meta.symbol)
        if tick:
            symbols.append({
                "symbol": meta.symbol,
                "name": meta.name,
                "sector": meta.sector,
                **tick,
                "spark": sim.spark(meta.symbol),
            })

    return {
        "symbols": symbols,
        "portfolio": portfolio.snapshot(portfolio.live_prices()),
        "serverTime": int(time.time() * 1000),
    }

@app.get("/api/candles/{symbol}")
def get_candles(symbol: str):
    sym = symbol.upper()
    candles = sim.candles(sym)
    if not candles:
        raise HTTPException(status_code=400, detail="Unknown symbol")
    return {
        "symbol": sym,
        "candleMs": 60_000,
        "candles": candles,
    }

@app.get("/api/book/{symbol}")
def get_book(symbol: str):
    sym = symbol.upper()
    book = eng.books.get(sym)
    if not book:
        raise HTTPException(status_code=400, detail="Unknown symbol")

    recent_trades = [
        t.to_dict() for t in eng.trades.recent(200)
        if t.symbol == sym
    ][:40]

    return {
        **book.snapshot(),
        "trades": recent_trades,
    }

@app.post("/api/orders")
async def place_order(req: OrderRequest):
    try:
        result = portfolio.place(
            symbol=req.symbol.upper(),
            side=req.side,
            order_type=req.type,
            price=float(req.price),
            qty=int(req.qty),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if result.get("fills"):
        await manager.broadcast({
            "type": "trades",
            "trades": [f.to_dict() for f in result["fills"]],
        })

    snap = book_snapshot(req.symbol)
    if snap:
        await manager.broadcast({"type": "book", **snap})
    await broadcast_portfolio()

    # Serialize fills for JSON response
    result_copy = dict(result)
    result_copy["fills"] = [f.to_dict() for f in result["fills"]]
    return result_copy

@app.delete("/api/orders/{order_id}")
async def cancel_order(order_id: str):
    sym = portfolio.cancel(order_id)
    if not sym:
        raise HTTPException(status_code=400, detail="Order not found")

    snap = book_snapshot(sym)
    if snap:
        await manager.broadcast({"type": "book", **snap})
    await broadcast_portfolio()

    return {"cancelled": order_id}

@app.get("/api/search")
def search_symbols(q: str = ""):
    return eng.trie.search(q.upper())

@app.get("/api/portfolio")
def get_portfolio():
    return portfolio.snapshot(portfolio.live_prices())

@app.post("/api/portfolio/reset")
async def reset_portfolio():
    snap = portfolio.reset(portfolio.live_prices())
    await broadcast_portfolio()
    return snap

@app.post("/api/reset")
async def reset_all():
    sim.reset()
    portfolio.reset(portfolio.live_prices())
    await broadcast_portfolio()
    return {"ok": True}

# ---------------------------- WebSockets ----------------------------

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws, "AAPL")
    now_ms = int(time.time() * 1000)

    await manager.send_to(ws, {"type": "hello", "serverTime": now_ms})
    book = book_snapshot("AAPL")
    if book:
        await manager.send_to(ws, {"type": "book", **book})
    await manager.send_to(ws, {
        "type": "portfolio",
        "portfolio": portfolio.snapshot(portfolio.live_prices()),
    })

    try:
        while True:
            text = await ws.receive_text()
            try:
                msg = json.loads(text)
                if msg.get("type") == "select" and isinstance(msg.get("symbol"), str):
                    sym = msg["symbol"].upper()
                    if sym in eng.books:
                        manager.set_symbol(ws, sym)
                        snap = book_snapshot(sym)
                        if snap:
                            await manager.send_to(ws, {"type": "book", **snap})
            except Exception:
                pass  # Ignore malformed frames
    except WebSocketDisconnect:
        manager.disconnect(ws)

# ---------------------------- Static Frontend ----------------------------

dist_dir = os.environ.get("DIST_DIR", os.path.abspath("dist"))
if os.path.exists(dist_dir) and os.path.exists(os.path.join(dist_dir, "index.html")):
    app.mount("/", StaticFiles(directory=dist_dir, html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 4000))
    uvicorn.run("python_server.server:app", host="0.0.0.0", port=port, reload=False)
