import { useEffect, useRef } from 'react';
export default function BackgroundCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!, x = c.getContext('2d')!; let raf = 0; const m = { x: -999, y: -999 };
    const resize = () => { c.width = innerWidth; c.height = innerHeight; }; resize(); addEventListener('resize', resize);
    const mv = (e: MouseEvent) => { m.x = e.clientX; m.y = e.clientY; }; addEventListener('mousemove', mv);
    const P = Array.from({ length: 90 }, () => ({ x: Math.random() * c.width, y: Math.random() * c.height, vx: (Math.random() - .5) * .5, vy: (Math.random() - .5) * .5 }));
    const draw = () => {
      const g = x.createLinearGradient(0, 0, c.width, c.height); g.addColorStop(0, '#050816'); g.addColorStop(.5, '#0b1030'); g.addColorStop(1, '#021a1a');
      x.fillStyle = g; x.fillRect(0, 0, c.width, c.height);
      for (const p of P) { p.x = (p.x + p.vx + c.width) % c.width; p.y = (p.y + p.vy + c.height) % c.height;
        const dm = Math.hypot(p.x - m.x, p.y - m.y); if (dm < 120 && dm > 0) { p.x += (p.x - m.x) / dm; p.y += (p.y - m.y) / dm; }
        x.fillStyle = 'rgba(56,189,248,.8)'; x.beginPath(); x.arc(p.x, p.y, 1.6, 0, 7); x.fill();
        for (const q of P) { const d = Math.hypot(p.x - q.x, p.y - q.y); if (d < 110) { x.strokeStyle = `rgba(56,189,248,${.15 * (1 - d / 110)})`; x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(q.x, q.y); x.stroke(); } } }
      raf = requestAnimationFrame(draw);
    }; draw();
    return () => { cancelAnimationFrame(raf); removeEventListener('resize', resize); removeEventListener('mousemove', mv); };
  }, []);
  return <canvas ref={ref} className="bg" />;
}
