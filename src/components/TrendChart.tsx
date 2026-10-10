"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface ChartPoint {
  t: number; // epoch ms
  v: number;
  status: string;
  label: string; // tooltip text
}

interface Props {
  points: ChartPoint[];
  from: number;
  to: number;
  unit: string | null;
  stdMin: number | null;
  stdMax: number | null;
  critMin: number | null;
  critMax: number | null;
}

const H = 280;
const M = { l: 48, r: 12, t: 12, b: 28 };
const lagosTick = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", day: "2-digit", month: "short" });
const lagosHour = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit" });

function niceTicks(lo: number, hi: number, n = 5): number[] {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

/** One parameter over time: standard band shaded green, critical limits dashed red, out-of-spec points marked. */
export function TrendChart(p: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  // draw at the real pixel width so axis text stays readable on phones
  const [W, setW] = useState(800);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { x, y, yTicks, xTicks, xStep, path } = useMemo(() => {
    const vals = p.points.map((d) => d.v);
    const limits = [p.stdMin, p.stdMax, p.critMin, p.critMax].filter((v): v is number => v !== null);
    let lo = Math.min(...vals, ...limits);
    let hi = Math.max(...vals, ...limits);
    if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    lo -= pad; hi += pad;
    const x = (t: number) => M.l + ((t - p.from) / (p.to - p.from || 1)) * (W - M.l - M.r);
    const y = (v: number) => M.t + (1 - (v - lo) / (hi - lo)) * (H - M.t - M.b);
    const yTicks = niceTicks(lo, hi);
    const maxTicks = Math.max(3, Math.floor((W - M.l - M.r) / 60));
    const steps = [3_600_000, 3 * 3_600_000, 6 * 3_600_000, 86_400_000, 2 * 86_400_000, 5 * 86_400_000, 7 * 86_400_000, 15 * 86_400_000];
    const xStep = steps.find((s) => (p.to - p.from) / s <= maxTicks) ?? 30 * 86_400_000;
    const xTicks: number[] = [];
    for (let t = Math.ceil(p.from / xStep) * xStep; t <= p.to; t += xStep) xTicks.push(t);
    // break the line where readings are more than 1/20 of the window apart (missed slots)
    const gap = Math.max((p.to - p.from) / 20, 4 * 3_600_000);
    const path = p.points
      .map((d, i) => `${i === 0 || d.t - p.points[i - 1].t > gap ? "M" : "L"}${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`)
      .join("");
    return { x, y, yTicks, xTicks, xStep, path };
  }, [p, W]);

  const fmtX = (t: number) => (xStep < 86_400_000 ? lagosHour.format(t) : lagosTick.format(t));
  const band = p.stdMin !== null || p.stdMax !== null
    ? { top: y(p.stdMax ?? Number.MAX_SAFE_INTEGER), bottom: y(p.stdMin ?? -Number.MAX_SAFE_INTEGER) }
    : null;

  function onMove(e: React.PointerEvent) {
    if (!svg.current || p.points.length === 0) return;
    const r = svg.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < p.points.length; i++) {
      if (Math.abs(x(p.points[i].t) - px) < Math.abs(x(p.points[best].t) - px)) best = i;
    }
    setHover(best);
  }

  const h = hover !== null ? p.points[hover] : null;
  const clampY = (v: number) => Math.min(Math.max(v, M.t), H - M.b);

  return (
    <div ref={box} className="relative">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block h-auto max-w-full touch-none select-none"
        onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} role="img"
        aria-label="Trend chart">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={W - M.r} y1={y(v)} y2={y(v)} stroke="#e5e7eb" />
            <text x={M.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{v}</text>
          </g>
        ))}
        {band && (
          <rect x={M.l} width={W - M.l - M.r} y={clampY(band.top)} height={Math.max(0, clampY(band.bottom) - clampY(band.top))}
            fill="#15803d" fillOpacity="0.1" />
        )}
        {[p.critMin, p.critMax].map((c, i) => c !== null && (
          <line key={i} x1={M.l} x2={W - M.r} y1={y(c)} y2={y(c)} stroke="#b91c1c" strokeDasharray="5 4" strokeWidth="1.5" />
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize="11" fill="#6b7280">{fmtX(t)}</text>
        ))}
        <line x1={M.l} x2={W - M.r} y1={H - M.b} y2={H - M.b} stroke="#9ca3af" />
        <path d={path} fill="none" stroke="#1d3f8f" strokeWidth="2" strokeLinejoin="round" />
        {p.points.map((d, i) => d.status === "out_of_spec" || d.status === "critical" ? (
          <circle key={i} cx={x(d.t)} cy={y(d.v)} r="4.5" fill={d.status === "critical" ? "#b91c1c" : "#d97706"} stroke="#fff" strokeWidth="2" />
        ) : null)}
        {h && (
          <g>
            <line x1={x(h.t)} x2={x(h.t)} y1={M.t} y2={H - M.b} stroke="#6b7280" strokeDasharray="3 3" />
            <circle cx={x(h.t)} cy={y(h.v)} r="5" fill="#1d3f8f" stroke="#fff" strokeWidth="2" />
          </g>
        )}
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-1 rounded-lg border bg-white px-2 py-1 text-xs shadow"
          style={{ left: `${Math.min(Math.max((x(h.t) / W) * 100, 5), 70)}%` }}>
          <b>{h.v} {p.unit}</b> · {h.label}
        </div>
      )}
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-600">
        <span><span className="mr-1 inline-block h-0.5 w-4 bg-brand-blue align-middle" />Reading</span>
        {band && <span><span className="mr-1 inline-block h-3 w-4 bg-green-700/10 align-middle" />Standard range</span>}
        {(p.critMin !== null || p.critMax !== null) && <span><span className="mr-1 inline-block w-4 border-t-2 border-dashed border-crit align-middle" />Critical limit</span>}
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-amber-600 align-middle" />Out of spec</span>
        <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-crit align-middle" />Critical</span>
      </div>
    </div>
  );
}
