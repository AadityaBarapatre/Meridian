import type { Trade } from '../types';
import { fmtPrice, fmtQty, fmtTimeSec } from '../lib/format';

export default function TradeFeed({ trades, symbol }: { trades: Trade[]; symbol: string }) {
  const visible = trades.slice(0, 22);
  let buyVol = 0;
  let sellVol = 0;
  for (const t of trades.slice(0, 80)) {
    if (t.side === 'B') buyVol += t.qty;
    else sellVol += t.qty;
  }
  const total = buyVol + sellVol || 1;
  const buyPct = (buyVol / total) * 100;

  return (
    <section className="panel tape-panel">
      <div className="panel-head">
        <h2>Time &amp; sales</h2>
        <span className="chip mono">{symbol}</span>
      </div>
      <div className="flow-meter">
        <div className="flow-bar">
          <div className="flow-buy" style={{ width: `${buyPct}%` }} />
        </div>
        <div className="flow-labels mono">
          <span className="up">B {buyPct.toFixed(0)}%</span>
          <span className="down">S {(100 - buyPct).toFixed(0)}%</span>
        </div>
      </div>
      <div className="tape-cols mono">
        <span>Time</span>
        <span>Price</span>
        <span>Size</span>
        <span>Side</span>
      </div>
      <div className="tape-list">
        {visible.length === 0 && <div className="empty-note">Waiting for prints…</div>}
        {visible.map(t => (
          <div key={t.id} className={`tape-row mono ${t.side === 'B' ? 'buy' : 'sell'}`}>
            <span className="dim">{fmtTimeSec(t.ts)}</span>
            <span>{fmtPrice(t.price)}</span>
            <span>{fmtQty(t.qty)}</span>
            <span className="tape-side">{t.side === 'B' ? 'BUY' : 'SELL'}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
