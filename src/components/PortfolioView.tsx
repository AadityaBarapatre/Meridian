import type { Portfolio, SymbolInfo } from '../types';
import {
  fmtMoney,
  fmtPct,
  fmtPrice,
  fmtQty,
  fmtSignedMoney,
  fmtTime,
} from '../lib/format';
import EquityChart from './EquityChart';
import Sparkline from './Sparkline';

const COLORS = ['#38bdf8', '#2ee6a8', '#a78bfa', '#fbbf24', '#fb7185', '#22d3ee', '#f472b6', '#84cc16'];

export function PortfolioMini({
  portfolio,
  onOpen,
}: {
  portfolio: Portfolio | null;
  onOpen: () => void;
}) {
  const p = portfolio;
  const up = (p?.totalPnl ?? 0) >= 0;
  return (
    <section className="panel mini-portfolio">
      <div className="panel-head">
        <h2>Portfolio</h2>
        <button className="ghost-link" onClick={onOpen}>
          Details →
        </button>
      </div>
      <div className="mini-equity mono">{fmtMoney(p?.equity ?? 0)}</div>
      <div className={`mini-pnl mono ${up ? 'up' : 'down'}`}>
        {fmtSignedMoney(p?.totalPnl ?? 0)} ({fmtPct(p?.totalPnlPct ?? 0)})
      </div>
      <div className="mini-rows">
        {p?.positions.length === 0 && (
          <div className="empty-note">No positions yet. Buy your first asset from the ticket.</div>
        )}
        {p?.positions.slice(0, 4).map(pos => {
          const gain = pos.unrealized >= 0;
          return (
            <div key={pos.symbol} className="mini-row">
              <span className="mini-sym">{pos.symbol}</span>
              <span className="mono dim">{fmtQty(pos.qty)} sh</span>
              <span className={`mono ${gain ? 'up' : 'down'}`}>{fmtPct(pos.unrealizedPct)}</span>
            </div>
          );
        })}
      </div>
      <div className="mini-foot">
        <div>
          <span>Cash</span>
          <b className="mono">{fmtMoney(p?.cash ?? 0)}</b>
        </div>
        <div>
          <span>Open orders</span>
          <b className="mono">{p?.orders.length ?? 0}</b>
        </div>
      </div>
    </section>
  );
}

export default function PortfolioView({
  portfolio,
  symbols,
  onTrade,
  onCancel,
  onReset,
}: {
  portfolio: Portfolio | null;
  symbols: SymbolInfo[];
  onTrade: (symbol: string, side: 'B' | 'S') => void;
  onCancel: (id: string) => void;
  onReset: () => void;
}) {
  const p = portfolio;
  const bySymbol = new Map(symbols.map(s => [s.symbol, s]));
  const cash = p?.cash ?? 0;
  const equity = p?.equity ?? 0;

  const allocations = [
    ...(p?.positions.map((pos, i) => ({
      label: pos.symbol,
      value: pos.marketValue,
      color: COLORS[i % COLORS.length],
    })) ?? []),
    { label: 'Cash', value: cash, color: 'rgba(148,163,184,0.35)' },
  ].filter(a => a.value > 0);
  const totalAlloc = allocations.reduce((s, a) => s + a.value, 0) || 1;
  let cursor = 0;
  const stops = allocations.map(a => {
    const start = cursor;
    cursor += (a.value / totalAlloc) * 100;
    return `${a.color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });

  return (
    <div className="portfolio-page">
      <div className="portfolio-top">
        <section className="panel equity-panel">
          <EquityChart history={p?.history ?? []} startEquity={p?.startEquity ?? 100000} />
        </section>

        <section className="panel alloc-panel">
          <div className="panel-head">
            <h2>Allocation</h2>
            <span className="chip">mark to market</span>
          </div>
          <div className="alloc-body">
            <div
              className="donut"
              style={{ background: `conic-gradient(${stops.length ? stops.join(',') : 'rgba(148,163,184,.2) 0 100%'})` }}
            >
              <div className="donut-hole">
                <span>Equity</span>
                <b className="mono">{fmtMoney(equity)}</b>
              </div>
            </div>
            <div className="alloc-legend">
              {allocations.map(a => (
                <div key={a.label} className="alloc-row">
                  <i style={{ background: a.color }} />
                  <span>{a.label}</span>
                  <b className="mono">{((a.value / totalAlloc) * 100).toFixed(1)}%</b>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="stat-row">
        <div className="panel stat">
          <span>Total equity</span>
          <b className="mono">{fmtMoney(equity)}</b>
          <em className={`mono ${(p?.totalPnl ?? 0) >= 0 ? 'up' : 'down'}`}>
            {fmtSignedMoney(p?.totalPnl ?? 0)} all time
          </em>
        </div>
        <div className="panel stat">
          <span>Buying power</span>
          <b className="mono">{fmtMoney(p?.buyingPower ?? 0)}</b>
          <em className="mono dim">cash {fmtMoney(cash)}</em>
        </div>
        <div className="panel stat">
          <span>Realized P&amp;L</span>
          <b className={`mono ${(p?.realized ?? 0) >= 0 ? 'up' : 'down'}`}>
            {fmtSignedMoney(p?.realized ?? 0)}
          </b>
          <em className="mono dim">{p?.positions.length ?? 0} open positions</em>
        </div>
        <div className="panel stat">
          <span>Open orders</span>
          <b className="mono">{p?.orders.length ?? 0}</b>
          <button className="ghost-link" onClick={onReset}>
            Reset paper account
          </button>
        </div>
      </div>

      <section className="panel holdings-panel">
        <div className="panel-head">
          <h2>Holdings</h2>
          <span className="chip">{p?.positions.length ?? 0} assets</span>
        </div>
        {p && p.positions.length > 0 ? (
          <div className="holdings-table">
            <div className="holdings-head mono">
              <span>Asset</span>
              <span>Price</span>
              <span>Shares</span>
              <span>Avg cost</span>
              <span>Market value</span>
              <span>Unrealized</span>
              <span>Weight</span>
              <span />
            </div>
            {p.positions.map(pos => {
              const info = bySymbol.get(pos.symbol);
              const up = pos.unrealized >= 0;
              return (
                <div key={pos.symbol} className="holdings-row">
                  <div className="holding-asset">
                    <span className="watch-sym">{pos.symbol}</span>
                    <span className="watch-name">{info?.name ?? ''}</span>
                  </div>
                  <div className="holding-price">
                    <span className="mono">{fmtPrice(pos.last)}</span>
                    <Sparkline values={info?.spark ?? []} up={(info?.changePct ?? 0) >= 0} width={54} height={22} fill={false} />
                  </div>
                  <span className="mono">{fmtQty(pos.qty)}</span>
                  <span className="mono dim">{fmtPrice(pos.avg)}</span>
                  <span className="mono">{fmtMoney(pos.marketValue)}</span>
                  <div className={`holding-pnl ${up ? 'up' : 'down'}`}>
                    <span className="mono">{fmtSignedMoney(pos.unrealized)}</span>
                    <span className="mono">{fmtPct(pos.unrealizedPct)}</span>
                  </div>
                  <div className="weight-cell">
                    <div className="weight-bar">
                      <i style={{ width: `${Math.min(100, pos.allocation)}%` }} />
                    </div>
                    <span className="mono dim">{pos.allocation.toFixed(1)}%</span>
                  </div>
                  <div className="holding-actions">
                    <button className="mini-btn buy" onClick={() => onTrade(pos.symbol, 'B')}>
                      Buy
                    </button>
                    <button className="mini-btn sell" onClick={() => onTrade(pos.symbol, 'S')}>
                      Sell
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-icon">◎</div>
            <h3>Your portfolio is empty</h3>
            <p>Pick a market from the watchlist and place your first paper trade.</p>
          </div>
        )}
      </section>

      <section className="panel orders-panel">
        <div className="panel-head">
          <h2>Open orders</h2>
          <span className="chip">{p?.orders.length ?? 0}</span>
        </div>
        {p && p.orders.length > 0 ? (
          <div className="orders-table">
            <div className="orders-head mono">
              <span>Time</span>
              <span>Symbol</span>
              <span>Side</span>
              <span>Type</span>
              <span>Limit</span>
              <span>Filled</span>
              <span>Remaining</span>
              <span />
            </div>
            {p.orders.map(o => (
              <div key={o.id} className="orders-row">
                <span className="mono dim">{fmtTime(o.ts)}</span>
                <span className="watch-sym">{o.symbol}</span>
                <span className={`mono ${o.side === 'B' ? 'up' : 'down'}`}>
                  {o.side === 'B' ? 'BUY' : 'SELL'}
                </span>
                <span className="mono dim">{o.type}</span>
                <span className="mono">{fmtPrice(o.price)}</span>
                <span className="mono">{fmtQty(o.qty - o.remaining)}</span>
                <span className="mono">{fmtQty(o.remaining)}</span>
                <button className="mini-btn ghost" onClick={() => onCancel(o.id)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-note">No resting orders.</div>
        )}
      </section>
    </div>
  );
}
