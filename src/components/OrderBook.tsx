import type { Book } from '../types';
import { fmtPrice, fmtQty } from '../lib/format';

export default function OrderBook({ book }: { book: Book | null }) {
  if (!book) {
    return (
      <section className="panel book-panel">
        <div className="panel-head">
          <h2>Order book</h2>
        </div>
        <div className="empty-note">Connecting to depth…</div>
      </section>
    );
  }

  const asks = book.asks.slice(0, 8);
  const bids = book.bids.slice(0, 8);
  const bestAsk = asks[0]?.price ?? 0;
  const bestBid = bids[0]?.price ?? 0;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
  const max = Math.max(
    1,
    ...asks.map(l => l.cum ?? 0),
    ...bids.map(l => l.cum ?? 0)
  );
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : book.last;

  return (
    <section className="panel book-panel">
      <div className="panel-head">
        <h2>Order book</h2>
        <span className="chip mono">{book.symbol}</span>
      </div>
      <div className="book-cols mono">
        <span>Price</span>
        <span>Size</span>
        <span>Total</span>
      </div>
      <div className="book-side">
        {[...asks].reverse().map(l => (
          <div key={`a${l.price}`} className="book-row ask">
            <div className="depth" style={{ width: `${(l.cum / max) * 100}%` }} />
            <span className="mono">{fmtPrice(l.price)}</span>
            <span className="mono">{fmtQty(l.qty)}</span>
            <span className="mono dim">{fmtQty(l.cum)}</span>
          </div>
        ))}
      </div>
      <div className="book-mid">
        <span className="mono">{fmtPrice(mid)}</span>
        <span className="book-spread mono">spread {spread.toFixed(2)}</span>
      </div>
      <div className="book-side">
        {bids.map(l => (
          <div key={`b${l.price}`} className="book-row bid">
            <div className="depth" style={{ width: `${(l.cum / max) * 100}%` }} />
            <span className="mono">{fmtPrice(l.price)}</span>
            <span className="mono">{fmtQty(l.qty)}</span>
            <span className="mono dim">{fmtQty(l.cum)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
