import { useEffect, useMemo, useState } from 'react';
import type { Portfolio, SymbolInfo } from '../types';
import { fmtMoney, fmtPct, fmtPrice, fmtQty } from '../lib/format';

export default function TradePanel({
  info,
  portfolio,
  preferredSide,
  onToast,
  onDone,
}: {
  info: SymbolInfo | null;
  portfolio: Portfolio | null;
  preferredSide: 'B' | 'S';
  onToast: (text: string, tone: 'good' | 'bad') => void;
  onDone: () => void;
}) {
  const [side, setSide] = useState<'B' | 'S'>('B');
  const [type, setType] = useState<'MARKET' | 'LIMIT'>('MARKET');
  const [qty, setQty] = useState('10');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  const symbol = info?.symbol ?? '';
  const position = portfolio?.positions.find(p => p.symbol === symbol);
  const shares = position?.available ?? position?.qty ?? 0;

  useEffect(() => {
    setPrice(info ? info.price.toFixed(2) : '');
    setMessage(null);
    setSide(preferredSide);
  }, [info?.symbol, preferredSide]);

  const numericQty = Math.max(0, Math.floor(Number(qty) || 0));
  const execPrice = type === 'LIMIT' ? Number(price) || 0 : info?.price ?? 0;
  const estimate = execPrice * numericQty;
  const maxQty =
    side === 'B'
      ? Math.floor((portfolio?.buyingPower ?? 0) / Math.max(0.01, execPrice || info?.price || 1))
      : shares;

  const costLabel = useMemo(
    () => (side === 'B' ? 'Estimated cost' : 'Estimated credit'),
    [side]
  );

  const submit = async () => {
    if (!symbol) return;
    if (numericQty <= 0) {
      setMessage({ text: 'Enter a quantity greater than zero', tone: 'bad' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          side,
          type,
          price: type === 'LIMIT' ? Number(price) : 0,
          qty: numericQty,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Order rejected');

      const verb = side === 'B' ? 'Bought' : 'Sold';
      const text =
        json.filledQty > 0
          ? `${verb} ${fmtQty(json.filledQty)} ${symbol} @ ${fmtPrice(json.avgPrice)}`
          : `Limit order resting · ${fmtQty(json.remaining)} ${symbol} @ ${fmtPrice(Number(price))}`;
      const tone: 'good' | 'bad' = 'good';
      setMessage({ text, tone });
      onToast(text, tone);
      onDone();
    } catch (e: any) {
      const text = e?.message || 'Order rejected';
      setMessage({ text, tone: 'bad' });
      onToast(text, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel trade-panel">
      <div className="panel-head">
        <h2>Trade ticket</h2>
        <span className="chip mono">{symbol || '—'}</span>
      </div>

      <div className="ticket-quote">
        <div>
          <span className="ticket-sym">{symbol}</span>
          <span className="ticket-name">{info?.name ?? 'Select a market'}</span>
        </div>
        <div className="ticket-price">
          <span className="mono">{info ? fmtPrice(info.price) : '—'}</span>
          <span className={`mono ${info && info.changePct >= 0 ? 'up' : 'down'}`}>
            {info ? fmtPct(info.changePct) : ''}
          </span>
        </div>
      </div>

      <div className="segmented side-toggle">
        <button className={side === 'B' ? 'active buy' : ''} onClick={() => setSide('B')}>
          Buy
        </button>
        <button className={side === 'S' ? 'active sell' : ''} onClick={() => setSide('S')}>
          Sell
        </button>
      </div>

      <div className="type-tabs">
        <button className={type === 'MARKET' ? 'active' : ''} onClick={() => setType('MARKET')}>
          Market
        </button>
        <button className={type === 'LIMIT' ? 'active' : ''} onClick={() => setType('LIMIT')}>
          Limit
        </button>
      </div>

      <label className="field">
        <span>Quantity</span>
        <div className="qty-input">
          <button
            type="button"
            onClick={() => setQty(String(Math.max(1, numericQty - 1)))}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <input
            value={qty}
            inputMode="numeric"
            onChange={e => setQty(e.target.value.replace(/[^0-9]/g, ''))}
            aria-label="Quantity"
          />
          <button
            type="button"
            onClick={() => setQty(String(numericQty + 1))}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>
      </label>

      <div className="quick-qty">
        {[0.25, 0.5, 0.75, 1].map(f => (
          <button
            key={f}
            type="button"
            onClick={() => setQty(String(Math.max(0, Math.floor(maxQty * f))))}
          >
            {f === 1 ? 'Max' : `${f * 100}%`}
          </button>
        ))}
      </div>

      {type === 'LIMIT' && (
        <label className="field">
          <span>Limit price</span>
          <input
            value={price}
            inputMode="decimal"
            onChange={e => setPrice(e.target.value.replace(/[^0-9.]/g, ''))}
            aria-label="Limit price"
          />
        </label>
      )}

      <div className="ticket-summary">
        <div>
          <span>{costLabel}</span>
          <b className="mono">{fmtMoney(estimate)}</b>
        </div>
        <div>
          <span>{side === 'B' ? 'Buying power' : 'Shares available'}</span>
          <b className="mono">
            {side === 'B' ? fmtMoney(portfolio?.buyingPower ?? 0) : `${fmtQty(shares)} sh`}
          </b>
        </div>
      </div>

      <button
        className={`trade-submit ${side === 'B' ? 'buy' : 'sell'}`}
        onClick={submit}
        disabled={busy || !symbol}
      >
        {busy ? 'Routing order…' : `${side === 'B' ? 'Buy' : 'Sell'} ${symbol || 'shares'}`}
      </button>

      <p className="ticket-note">
        <i className="dot" /> Paper account · simulated liquidity · no real money
      </p>

      {message && <div className={`ticket-msg ${message.tone}`}>{message.text}</div>}
    </section>
  );
}
