import { useId, useMemo } from 'react';
import type { EquityPoint } from '../types';
import { fmtMoney, fmtTime } from '../lib/format';

export default function EquityChart({
  history,
  startEquity,
}: {
  history: EquityPoint[];
  startEquity: number;
}) {
  const id = useId().replace(/:/g, '');
  const W = 800;
  const H = 230;

  const model = useMemo(() => {
    const values = history.length ? history : [{ t: Date.now(), equity: startEquity }];
    let min = values[0].equity;
    let max = values[0].equity;
    for (const p of values) {
      min = Math.min(min, p.equity);
      max = Math.max(max, p.equity);
    }
    min = Math.min(min, startEquity);
    max = Math.max(max, startEquity);
    const pad = (max - min || max * 0.002 || 1) * 0.22;
    min -= pad;
    max += pad;
    const x = (i: number) => 2 + (i / Math.max(1, values.length - 1)) * (W - 4);
    const y = (v: number) => 8 + ((max - v) / (max - min)) * (H - 20);
    const points = values.map((p, i) => `${x(i).toFixed(2)},${y(p.equity).toFixed(2)}`);
    const line = `M${points.join(' L')}`;
    const area = `${line} L${x(values.length - 1).toFixed(2)},${H} L${x(0).toFixed(2)},${H} Z`;
    const baseY = y(startEquity);
    return { line, area, baseY, first: values[0], last: values.at(-1)!, values };
  }, [history, startEquity]);

  const up = model.last.equity >= startEquity;
  const color = up ? '#2ee6a8' : '#ff5d7a';
  const pct = ((model.last.equity - startEquity) / startEquity) * 100;

  return (
    <div className="equity-chart">
      <div className="equity-chart-head">
        <div>
          <span className="eyebrow">Account equity</span>
          <div className="equity-big mono">{fmtMoney(model.last.equity)}</div>
        </div>
        <div className={`equity-delta ${up ? 'up' : 'down'}`}>
          <span className="mono">{`${up ? '+' : ''}${fmtMoney(model.last.equity - startEquity)}`}</span>
          <span className="mono">{`${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`}</span>
        </div>
      </div>
      <div className="equity-plot">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={`eq${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`ln${id}`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor={up ? '#38bdf8' : '#ff5d7a'} />
              <stop offset="100%" stopColor={color} />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map(f => (
            <line
              key={f}
              x1="0"
              x2={W}
              y1={8 + f * (H - 20)}
              y2={8 + f * (H - 20)}
              stroke="rgba(148,163,184,0.08)"
              strokeWidth="1"
            />
          ))}
          <line
            x1="0"
            x2={W}
            y1={model.baseY}
            y2={model.baseY}
            stroke="rgba(148,163,184,0.28)"
            strokeWidth="1"
            strokeDasharray="4 5"
          />
          <path d={model.area} fill={`url(#eq${id})`} />
          <path
            d={model.line}
            fill="none"
            stroke={`url(#ln${id})`}
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <div className="equity-axis mono">
          <span>{fmtTime(model.first.t)}</span>
          <span>now</span>
        </div>
      </div>
    </div>
  );
}
