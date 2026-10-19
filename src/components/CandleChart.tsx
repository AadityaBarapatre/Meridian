import { useEffect, useMemo, useRef } from 'react';
import type { Candle, Timeframe } from '../types';
import { fmtPrice, fmtTime, fmtQty } from '../lib/format';

const UP = '#2ee6a8';
const DOWN = '#ff5d7a';
const GRID = 'rgba(148,163,184,0.08)';
const AXIS = '#64748b';
const MONO = '500 10px "JetBrains Mono", ui-monospace, monospace';

function aggregate(candles: Candle[], minutes: number): Candle[] {
  const bucket = minutes * 60_000;
  const out: Candle[] = [];
  for (const c of candles) {
    const t = Math.floor(c.t / bucket) * bucket;
    const last = out[out.length - 1];
    if (last && last.t === t) {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    } else {
      out.push({ t, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    }
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export default function CandleChart({
  candles,
  timeframe,
  symbol,
}: {
  candles: Candle[];
  timeframe: Timeframe;
  symbol: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const series = useMemo(() => aggregate(candles, timeframe), [candles, timeframe]);
  const lines = useMemo(
    () => ({
      fast: ema(series.map(c => c.c), 12),
      slow: ema(series.map(c => c.c), 26),
    }),
    [series]
  );

  const dataRef = useRef<Candle[]>(series);
  const linesRef = useRef(lines);
  const hoverRef = useRef<{ x: number; y: number } | null>(null);
  const domainRef = useRef<[number, number] | null>(null);
  const visibleRef = useRef(110);
  const dirtyRef = useRef(true);

  dataRef.current = series;
  linesRef.current = lines;
  useEffect(() => {
    dirtyRef.current = true;
  }, [series, lines]);

  useEffect(() => {
    domainRef.current = null;
    dirtyRef.current = true;
  }, [symbol]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = wrap.clientWidth;
      h = wrap.clientHeight;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirtyRef.current = true;
    };
    resize();

    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    document.fonts?.ready.then(() => (dirtyRef.current = true));

    const draw = () => {
      raf = requestAnimationFrame(draw);
      if (!w || !h) return;

      const data = dataRef.current;
      const n = Math.min(visibleRef.current, data.length);
      const slice = data.slice(-n);
      const padL = 8;
      const padR = 64;
      const padT = 14;
      const padB = 22;
      const plotW = w - padL - padR;
      const bottom = h - padB;
      const volH = Math.max(34, (h - padT - padB) * 0.16);
      const gap = 12;
      const priceH = h - padT - padB - volH - gap;
      const volTop = padT + priceH + gap;

      if (!slice.length || plotW <= 0) {
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = AXIS;
        ctx.font = MONO;
        ctx.fillText('Loading market data…', 16, 28);
        return;
      }

      let lo = Infinity;
      let hi = -Infinity;
      for (const c of slice) {
        if (c.l < lo) lo = c.l;
        if (c.h > hi) hi = c.h;
      }
      const span = Math.max(hi - lo, slice.at(-1)!.c * 0.0009);
      lo -= span * 0.08;
      hi += span * 0.12;

      let domain = domainRef.current;
      if (!domain) {
        domain = [lo, hi];
        domainRef.current = domain;
      } else {
        domain[0] += (lo - domain[0]) * 0.18;
        domain[1] += (hi - domain[1]) * 0.18;
        if (Math.abs(lo - domain[0]) < 0.002) domain[0] = lo;
        if (Math.abs(hi - domain[1]) < 0.002) domain[1] = hi;
      }
      const moving = domain[0] !== lo || domain[1] !== hi;
      if (!dirtyRef.current && !moving && !hoverRef.current) return;
      dirtyRef.current = false;

      const [dlo, dhi] = domain;
      const y = (p: number) => padT + ((dhi - p) / (dhi - dlo)) * priceH;
      const slot = plotW / n;
      const bodyW = Math.max(1.4, Math.min(11, slot * 0.58));

      ctx.clearRect(0, 0, w, h);

      // Watermark
      ctx.save();
      ctx.fillStyle = 'rgba(148,163,184,0.045)';
      ctx.font = '700 64px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(symbol, padL + plotW / 2, padT + priceH * 0.45);
      ctx.restore();

      // Horizontal grid + price axis
      const rows = 5;
      ctx.font = MONO;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (let i = 0; i <= rows; i++) {
        const gy = padT + (priceH / rows) * i;
        const price = dhi - ((dhi - dlo) / rows) * i;
        ctx.strokeStyle = GRID;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padL, Math.round(gy) + 0.5);
        ctx.lineTo(padL + plotW, Math.round(gy) + 0.5);
        ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtPrice(price), padL + plotW + 8, gy);
      }

      // Vertical grid + time axis
      const cols = Math.min(6, Math.max(2, Math.floor(plotW / 130)));
      ctx.textAlign = 'center';
      for (let i = 0; i <= cols; i++) {
        const idx = Math.round(((n - 1) / cols) * i);
        const c = slice[idx];
        if (!c) continue;
        const gx = padL + (idx + 0.5) * slot;
        ctx.strokeStyle = GRID;
        ctx.beginPath();
        ctx.moveTo(Math.round(gx) + 0.5, padT);
        ctx.lineTo(Math.round(gx) + 0.5, bottom);
        ctx.stroke();
        ctx.fillStyle = AXIS;
        ctx.fillText(fmtTime(c.t), gx, h - 9);
      }

      // Volume
      let maxVol = 1;
      for (const c of slice) maxVol = Math.max(maxVol, c.v);
      for (let i = 0; i < n; i++) {
        const c = slice[i];
        const x = padL + (i + 0.5) * slot;
        const vh = Math.max(1, (c.v / maxVol) * volH);
        ctx.fillStyle = c.c >= c.o ? 'rgba(46,230,168,0.22)' : 'rgba(255,93,122,0.22)';
        ctx.fillRect(x - bodyW / 2, bottom - vh, bodyW, vh);
      }
      ctx.strokeStyle = 'rgba(148,163,184,0.1)';
      ctx.beginPath();
      ctx.moveTo(padL, volTop - gap / 2 + 0.5);
      ctx.lineTo(padL + plotW, volTop - gap / 2 + 0.5);
      ctx.stroke();

      // EMA overlays
      const drawLine = (values: number[], color: string) => {
        const offset = values.length - n;
        ctx.beginPath();
        for (let i = 0; i < n; i++) {
          const v = values[offset + i];
          if (v == null) continue;
          const x = padL + (i + 0.5) * slot;
          const yy = y(v);
          if (i === 0) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.3;
        ctx.lineJoin = 'round';
        ctx.stroke();
      };
      ctx.save();
      ctx.globalAlpha = 0.8;
      drawLine(linesRef.current.fast, '#38bdf8');
      drawLine(linesRef.current.slow, '#a78bfa');
      ctx.restore();

      // Candles
      for (let i = 0; i < n; i++) {
        const c = slice[i];
        const x = padL + (i + 0.5) * slot;
        const up = c.c >= c.o;
        const color = up ? UP : DOWN;
        const last = i === n - 1;
        ctx.save();
        if (last) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
        }
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.min(1.4, Math.max(1, slot * 0.12));
        ctx.beginPath();
        ctx.moveTo(x, y(c.h));
        ctx.lineTo(x, y(c.l));
        ctx.stroke();

        const top = y(Math.max(c.o, c.c));
        const bodyH = Math.max(1.2, y(Math.min(c.o, c.c)) - top);
        ctx.fillStyle = color;
        roundRect(ctx, x - bodyW / 2, top, bodyW, bodyH, Math.min(2.5, bodyW / 3));
        ctx.fill();
        ctx.restore();
      }

      // Last price marker
      const lastCandle = slice[n - 1];
      const lastY = y(lastCandle.c);
      const up = lastCandle.c >= lastCandle.o;
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = up ? 'rgba(46,230,168,0.55)' : 'rgba(255,93,122,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, lastY);
      ctx.lineTo(padL + plotW, lastY);
      ctx.stroke();
      ctx.restore();

      const badgeW = padR - 10;
      ctx.fillStyle = up ? UP : DOWN;
      roundRect(ctx, padL + plotW + 5, lastY - 9, badgeW, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#04140e';
      ctx.font = '600 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(fmtPrice(lastCandle.c), padL + plotW + 5 + badgeW / 2, lastY);

      // Crosshair + tooltip
      const hover = hoverRef.current;
      if (hover && hover.x >= padL && hover.x <= padL + plotW && hover.y >= padT && hover.y <= bottom) {
        const idx = Math.max(0, Math.min(n - 1, Math.floor((hover.x - padL) / slot)));
        const c = slice[idx];
        const cx = padL + (idx + 0.5) * slot;
        const hy = Math.max(padT, Math.min(padT + priceH, hover.y));
        const hoverPrice = dhi - ((hy - padT) / priceH) * (dhi - dlo);

        ctx.save();
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = 'rgba(203,213,225,0.35)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, padT);
        ctx.lineTo(cx, bottom);
        ctx.moveTo(padL, hy);
        ctx.lineTo(padL + plotW, hy);
        ctx.stroke();
        ctx.restore();

        // price tag
        ctx.fillStyle = '#1e293b';
        roundRect(ctx, padL + plotW + 5, hy - 9, badgeW, 18, 4);
        ctx.fill();
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(fmtPrice(hoverPrice), padL + plotW + 5 + badgeW / 2, hy);

        // time tag
        const label = fmtTime(c.t);
        ctx.font = MONO;
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = '#1e293b';
        roundRect(ctx, cx - tw / 2, bottom + 2, tw, 16, 3);
        ctx.fill();
        ctx.fillStyle = '#cbd5e1';
        ctx.fillText(label, cx, bottom + 10);

        // tooltip
        const tw2 = 152;
        const th2 = 106;
        let tx = cx + 16;
        let ty = padT + 12;
        if (tx + tw2 > padL + plotW - 8) tx = cx - tw2 - 16;
        if (ty + th2 > padT + priceH) ty = padT + priceH - th2 - 8;

        ctx.fillStyle = 'rgba(8,12,20,0.95)';
        ctx.strokeStyle = 'rgba(148,163,184,0.22)';
        ctx.lineWidth = 1;
        roundRect(ctx, tx, ty, tw2, th2, 8);
        ctx.fill();
        ctx.stroke();

        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.font = '600 10px Inter, sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`${symbol}  ·  ${fmtTime(c.t)}`, tx + 12, ty + 15);

        const rows2: [string, string, string][] = [
          ['O', fmtPrice(c.o), '#e2e8f0'],
          ['H', fmtPrice(c.h), UP],
          ['L', fmtPrice(c.l), DOWN],
          ['C', fmtPrice(c.c), c.c >= c.o ? UP : DOWN],
          ['VOL', fmtQty(c.v), '#cbd5e1'],
        ];
        rows2.forEach(([k, v, col], i) => {
          const yy = ty + 36 + i * 15;
          ctx.font = MONO;
          ctx.fillStyle = '#64748b';
          ctx.fillText(k, tx + 12, yy);
          ctx.fillStyle = col;
          ctx.textAlign = 'right';
          ctx.fillText(v, tx + tw2 - 12, yy);
          ctx.textAlign = 'left';
        });
      }
    };

    raf = requestAnimationFrame(draw);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      hoverRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      dirtyRef.current = true;
    };
    const onLeave = () => {
      hoverRef.current = null;
      dirtyRef.current = true;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = visibleRef.current + (e.deltaY > 0 ? 14 : -14);
      visibleRef.current = Math.max(40, Math.min(320, next));
      dirtyRef.current = true;
    };
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener('mousemove', onMove);
      canvas.removeEventListener('mouseleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [symbol]);

  const last = series.at(-1);
  const prev = series.at(-2);
  const up = last && prev ? last.c >= prev.c : true;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <div className="chart-legend">
        <span className="legend-item">
          <i style={{ background: '#38bdf8' }} /> EMA 12
        </span>
        <span className="legend-item">
          <i style={{ background: '#a78bfa' }} /> EMA 26
        </span>
        {last && (
          <span className={`legend-ohlc mono ${up ? 'up' : 'down'}`}>
            O {fmtPrice(last.o)} · H {fmtPrice(last.h)} · L {fmtPrice(last.l)} · C {fmtPrice(last.c)}
          </span>
        )}
      </div>
      <canvas ref={canvasRef} className="candle-canvas" />
      <div className="chart-hint">Scroll to zoom · hover for OHLC</div>
    </div>
  );
}
