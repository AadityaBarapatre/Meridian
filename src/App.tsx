import { useEffect, useMemo, useRef, useState } from 'react';
import BackgroundCanvas from './components/BackgroundCanvas';
import CandleChart from './components/CandleChart';
import MarketWatch from './components/MarketWatch';
import OrderBook from './components/OrderBook';
import TradeFeed from './components/TradeFeed';
import TradePanel from './components/TradePanel';
import PortfolioView, { PortfolioMini } from './components/PortfolioView';
import type {
  Book,
  Candle,
  Portfolio,
  SymbolInfo,
  Tick,
  Timeframe,
  Trade,
} from './types';
import {
  fmtCompact,
  fmtCompactMoney,
  fmtPct,
  fmtPrice,
  fmtQty,
  fmtSignedMoney,
  fmtTime,
} from './lib/format';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: 1, label: '1m' },
  { value: 5, label: '5m' },
  { value: 15, label: '15m' },
  { value: 60, label: '1H' },
];

function mergeCandle(list: Candle[], next: Candle): Candle[] {
  const last = list[list.length - 1];
  if (!last) return [next];
  if (next.t === last.t) return [...list.slice(0, -1), next];
  if (next.t > last.t) return [...list, next].slice(-720);
  return list;
}

export default function App() {
  const [page, setPage] = useState<'terminal' | 'portfolio'>('terminal');
  const [symbol, setSymbol] = useState('AAPL');
  const symRef = useRef(symbol);
  symRef.current = symbol;

  const [symbols, setSymbols] = useState<SymbolInfo[]>([]);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [book, setBook] = useState<Book | null>(null);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [timeframe, setTimeframe] = useState<Timeframe>(1);
  const [preferredSide, setPreferredSide] = useState<'B' | 'S'>('B');
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; tone: 'good' | 'bad' } | null>(null);
  const tradeBuf = useRef(new Map<string, Trade[]>());
  const socketRef = useRef<WebSocket | null>(null);

  const info = useMemo(() => symbols.find(s => s.symbol === symbol) ?? null, [symbols, symbol]);
  const up = (info?.changePct ?? 0) >= 0;

  const notify = (text: string, tone: 'good' | 'bad') => {
    setToast({ id: Date.now(), text, tone });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3800);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  useEffect(() => {
    fetch('/api/bootstrap')
      .then(r => r.json())
      .then(j => {
        setSymbols(j.symbols);
        setPortfolio(j.portfolio);
      })
      .catch(() => notify('Could not reach the market engine', 'bad'));
  }, []);

  useEffect(() => {
    let dead = false;
    setCandles([]);
    setBook(null);
    setTrades([]);
    fetch(`/api/candles/${symbol}`)
      .then(r => r.json())
      .then(j => {
        if (!dead) setCandles(j.candles ?? []);
      })
      .catch(() => {});
    fetch(`/api/book/${symbol}`)
      .then(r => r.json())
      .then(j => {
        if (dead) return;
        setBook(j);
        setTrades(j.trades ?? []);
        tradeBuf.current.set(symbol, j.trades ?? []);
      })
      .catch(() => {});
    return () => {
      dead = true;
    };
  }, [symbol]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let dead = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      socket = new WebSocket(`ws://${location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
        socket?.send(JSON.stringify({ type: 'select', symbol: symRef.current }));
      };
      socket.onclose = () => {
        setConnected(false);
        if (dead) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(5000, 500 * retry));
      };
      socket.onerror = () => setConnected(false);
      socket.onmessage = e => {
        let msg: any;
        try {
          msg = JSON.parse(e.data);
        } catch {
          return;
        }
        if (msg.type === 'ticks' && Array.isArray(msg.ticks)) {
          const ticks: Tick[] = msg.ticks;
          setSymbols(prev => {
            if (!prev.length) return prev;
            const map = new Map(ticks.map(t => [t.symbol, t]));
            return prev.map(s => {
              const t = map.get(s.symbol);
              if (!t) return s;
              return {
                ...s,
                price: t.price,
                change: t.change,
                changePct: t.changePct,
                open: t.open,
                high: t.high,
                low: t.low,
                volume: t.volume,
              };
            });
          });
          const active = ticks.find(t => t.symbol === symRef.current);
          if (active) setCandles(prev => mergeCandle(prev, active.candle));
        } else if (msg.type === 'trades' && Array.isArray(msg.trades)) {
          const incoming: Trade[] = msg.trades;
          for (const t of incoming) {
            const buf = tradeBuf.current.get(t.symbol) ?? [];
            tradeBuf.current.set(t.symbol, [t, ...buf].slice(0, 60));
          }
          const active = tradeBuf.current.get(symRef.current);
          if (active && incoming.some(t => t.symbol === symRef.current)) setTrades([...active]);
        } else if (msg.type === 'book') {
          if (msg.symbol === symRef.current) setBook(msg);
        } else if (msg.type === 'portfolio') {
          setPortfolio(msg.portfolio);
        }
      };
    };

    connect();
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  const selectSymbol = (next: string) => {
    setSymbol(next);
    setPage('terminal');
  };

  // Send depth subscription whenever the active symbol changes.
  useEffect(() => {
    const current = socketRef.current;
    if (current && current.readyState === WebSocket.OPEN) {
      current.send(JSON.stringify({ type: 'select', symbol }));
    }
  }, [symbol]);

  const refreshPortfolio = () =>
    fetch('/api/portfolio')
      .then(r => r.json())
      .then(setPortfolio)
      .catch(() => {});

  const cancelOrder = async (id: string) => {
    try {
      const res = await fetch(`/api/orders/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      await refreshPortfolio();
      notify('Order cancelled', 'good');
    } catch (e: any) {
      notify(e?.message ?? 'Could not cancel order', 'bad');
    }
  };

  const resetAccount = async () => {
    try {
      await fetch('/api/portfolio/reset', { method: 'POST' });
      await refreshPortfolio();
      notify('Paper account reset to $100,000', 'good');
    } catch {
      notify('Reset failed', 'bad');
    }
  };

  const tradeFromPortfolio = (sym: string, side: 'B' | 'S') => {
    setSymbol(sym);
    setPreferredSide(side);
    setPage('terminal');
  };

  return (
    <>
      <BackgroundCanvas />
      <div className="shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 32 32" width="24" height="24">
                <rect x="5" y="12" width="4" height="9" rx="1" fill="#2ee6a8" />
                <rect x="7" y="8" width="0.01" height="6" stroke="#2ee6a8" strokeWidth="1.6" />
                <rect x="7" y="21" width="0.01" height="4" stroke="#2ee6a8" strokeWidth="1.6" />
                <rect x="14" y="7" width="4" height="13" rx="1" fill="#ff5d7a" />
                <rect x="16" y="4" width="0.01" height="5" stroke="#ff5d7a" strokeWidth="1.6" />
                <rect x="16" y="20" width="0.01" height="4" stroke="#ff5d7a" strokeWidth="1.6" />
                <rect x="23" y="14" width="4" height="8" rx="1" fill="#38bdf8" />
                <rect x="25" y="10" width="0.01" height="6" stroke="#38bdf8" strokeWidth="1.6" />
                <rect x="25" y="22" width="0.01" height="3" stroke="#38bdf8" strokeWidth="1.6" />
              </svg>
            </div>
            <div>
              <h1>Meridian</h1>
              <span>Paper trading terminal</span>
            </div>
          </div>

          <nav className="nav-tabs">
            <button className={page === 'terminal' ? 'active' : ''} onClick={() => setPage('terminal')}>
              Terminal
            </button>
            <button className={page === 'portfolio' ? 'active' : ''} onClick={() => setPage('portfolio')}>
              Portfolio
            </button>
          </nav>

          <div className="topbar-right">
            <span className={`conn ${connected ? 'on' : 'off'}`}>
              <i /> {connected ? 'Market open' : 'Reconnecting'}
            </span>
            <div className="acct">
              <span>Equity</span>
              <b className="mono">{portfolio ? `$${portfolio.equity.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'}</b>
            </div>
            <div className="acct">
              <span>All-time P&amp;L</span>
              <b className={`mono ${(portfolio?.totalPnl ?? 0) >= 0 ? 'up' : 'down'}`}>
                {portfolio ? `${fmtSignedMoney(portfolio.totalPnl)} · ${fmtPct(portfolio.totalPnlPct)}` : '—'}
              </b>
            </div>
          </div>
        </header>

        {page === 'terminal' ? (
          <div className="workspace">
            <MarketWatch symbols={symbols} active={symbol} onSelect={selectSymbol} />

            <main className="center">
              <section className="panel chart-panel">
                <div className="chart-head">
                  <div className="asset-id">
                    <div className="asset-logo">{symbol.slice(0, 2)}</div>
                    <div>
                      <div className="asset-title">
                        <h2>{symbol}</h2>
                        <span className="asset-tag">{info?.sector ?? '—'}</span>
                      </div>
                      <span className="asset-name">{info?.name ?? ''}</span>
                    </div>
                  </div>

                  <div className="asset-quote">
                    <div className={`asset-price mono ${up ? 'up' : 'down'}`}>
                      {info ? fmtPrice(info.price) : '—'}
                    </div>
                    <div className={`asset-change mono ${up ? 'up' : 'down'}`}>
                      <span>{info ? `${info.change >= 0 ? '+' : ''}${info.change.toFixed(2)}` : ''}</span>
                      <span>{info ? fmtPct(info.changePct) : ''}</span>
                    </div>
                  </div>

                  <div className="chart-stats mono">
                    <div>
                      <span>Open</span>
                      <b>{info ? fmtPrice(info.open) : '—'}</b>
                    </div>
                    <div>
                      <span>High</span>
                      <b className="up">{info ? fmtPrice(info.high) : '—'}</b>
                    </div>
                    <div>
                      <span>Low</span>
                      <b className="down">{info ? fmtPrice(info.low) : '—'}</b>
                    </div>
                    <div>
                      <span>Volume</span>
                      <b>{info ? fmtCompact(info.volume) : '—'}</b>
                    </div>
                  </div>

                  <div className="tf-tabs">
                    {TIMEFRAMES.map(tf => (
                      <button
                        key={tf.value}
                        className={timeframe === tf.value ? 'active' : ''}
                        onClick={() => setTimeframe(tf.value)}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                </div>

                <CandleChart candles={candles} timeframe={timeframe} symbol={symbol} />
              </section>

              <div className="lower-grid">
                <OrderBook book={book} />
                <TradeFeed trades={trades} symbol={symbol} />

                <section className="panel works-panel">
                  <div className="panel-head">
                    <h2>Working orders</h2>
                    <span className="chip">{portfolio?.orders.length ?? 0}</span>
                  </div>
                  {portfolio && portfolio.orders.length > 0 ? (
                    <div className="works-list">
                      {portfolio.orders.slice(0, 7).map(o => (
                        <div key={o.id} className="work-row">
                          <div>
                            <span className="watch-sym">{o.symbol}</span>
                            <span className={`mono ${o.side === 'B' ? 'up' : 'down'}`}>
                              {o.side === 'B' ? 'BUY' : 'SELL'} {o.type}
                            </span>
                          </div>
                          <span className="mono dim">
                            {fmtQty(o.remaining)} / {fmtQty(o.qty)} @ {fmtPrice(o.price)}
                          </span>
                          <button className="mini-btn ghost" onClick={() => cancelOrder(o.id)}>
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="empty-note">No working orders.</div>
                  )}
                  <div className="works-exposure">
                    <div className="works-subhead">
                      <span>Exposure</span>
                      <span className="mono dim">mark to market</span>
                    </div>
                    {portfolio && portfolio.positions.length > 0 ? (
                      portfolio.positions.slice(0, 4).map(pos => (
                        <div key={pos.symbol} className="exposure-row">
                          <span className="watch-sym">{pos.symbol}</span>
                          <span className="mono dim">{fmtQty(pos.qty)} sh</span>
                          <span className="mono">{fmtCompactMoney(pos.marketValue)}</span>
                          <span className={`mono ${pos.unrealized >= 0 ? 'up' : 'down'}`}>
                            {fmtPct(pos.unrealizedPct)}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="exposure-empty">No open exposure — all cash.</div>
                    )}
                  </div>
                  <div className="works-foot">
                    <span>Cash</span>
                    <b className="mono">{portfolio ? fmtCompactMoney(portfolio.cash) : '—'}</b>
                  </div>
                </section>
              </div>
            </main>

            <aside className="right-rail">
              <TradePanel
                info={info}
                portfolio={portfolio}
                preferredSide={preferredSide}
                onToast={notify}
                onDone={refreshPortfolio}
              />
              <PortfolioMini portfolio={portfolio} onOpen={() => setPage('portfolio')} />
            </aside>
          </div>
        ) : (
          <PortfolioView
            portfolio={portfolio}
            symbols={symbols}
            onTrade={tradeFromPortfolio}
            onCancel={cancelOrder}
            onReset={resetAccount}
          />
        )}

        <footer className="app-foot">
          <span>Meridian · simulated exchange · {fmtTime(Date.now())}</span>
          <span className="mono">
            {portfolio ? `${portfolio.positions.length} positions · ${portfolio.orders.length} open orders` : ''}
          </span>
        </footer>
      </div>

      {toast && (
        <div key={toast.id} className={`toast ${toast.tone}`}>
          <i />
          {toast.text}
        </div>
      )}
    </>
  );
}
