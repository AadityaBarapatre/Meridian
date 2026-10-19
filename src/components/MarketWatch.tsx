import type { SymbolInfo } from '../types';
import { fmtPct, fmtPrice } from '../lib/format';
import Sparkline from './Sparkline';

export default function MarketWatch({
  symbols,
  active,
  onSelect,
}: {
  symbols: SymbolInfo[];
  active: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <aside className="panel watch">
      <div className="panel-head">
        <h2>Markets</h2>
        <span className="chip">
          <i className="live-dot" /> live
        </span>
      </div>
      <div className="watch-list">
        {symbols.length === 0 && <div className="skeleton-list" />}
        {symbols.map(s => {
          const up = s.changePct >= 0;
          return (
            <button
              key={s.symbol}
              className={`watch-row ${active === s.symbol ? 'active' : ''}`}
              onClick={() => onSelect(s.symbol)}
            >
              <div className="watch-meta">
                <span className="watch-sym">{s.symbol}</span>
                <span className="watch-name">{s.name}</span>
              </div>
              <Sparkline values={s.spark} up={up} />
              <div className="watch-quote">
                <span className="watch-price mono">{fmtPrice(s.price)}</span>
                <span className={`watch-chg mono ${up ? 'up' : 'down'}`}>{fmtPct(s.changePct)}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="watch-foot">
        <span>Simulated tape</span>
        <span className="mono">8 symbols</span>
      </div>
    </aside>
  );
}
