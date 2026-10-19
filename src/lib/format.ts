export const fmtPrice = (v: number) =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '—';

export const fmtMoney = (v: number) =>
  Number.isFinite(v)
    ? `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';

export const fmtCompactMoney = (v: number) => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return fmtMoney(v);
};

export const fmtCompact = (v: number) =>
  Number.isFinite(v)
    ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(v)
    : '—';

export const fmtPct = (v: number, digits = 2) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%` : '—';

export const fmtSignedMoney = (v: number) =>
  Number.isFinite(v) ? `${v >= 0 ? '+' : '-'}$${Math.abs(v).toFixed(2)}` : '—';

export const fmtQty = (v: number) => Math.round(v).toLocaleString('en-US');

export const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

export const fmtTimeSec = (t: number) =>
  new Date(t).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

export const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
