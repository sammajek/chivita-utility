"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/*
 * Small SVG charts for the dashboard (no chart library). Rules followed:
 * one y-axis; thin marks (2px lines, 8px markers, 4px rounded bar ends on the baseline);
 * recessive grid; a legend whenever there are 2+ series, plus direct labels; text in ink colours, never series colours;
 * a hover tooltip on every mark; a table view under each chart.
 * Series colours: reference categorical slots 1–2 (validated for colour-blind separation and contrast).
 */
export const SERIES = ["#2a78d6", "#eb6834"] as const;
const INK = "#0b0b0b", INK2 = "#52514e", MUTED = "#898781", GRID = "#e1e0d9", BASE = "#c3c2b7", SURFACE = "#ffffff";

function useWidth(min = 280) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= v) ?? v);
}

function Tooltip({ x, y, w, children }: { x: number; y: number; w: number; children: ReactNode }) {
  // inside the chart box (which clips overflow): to the right of the mark, or to its left near the right edge
  const left = x + 12 + 210 <= w ? x + 12 : Math.max(0, x - 12 - 210);
  return (
    <div className="pointer-events-none absolute z-10 w-[210px] rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md"
      style={{ left, top: y, color: INK }}>
      {children}
    </div>
  );
}

function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: INK2 }}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  );
}

function TableView({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-gray-500">Show as table</summary>
      <div className="table-wrap mt-1">
        <table className="data-table compact text-xs">
          <thead><tr>{head.map((h, i) => <th key={h} className={i ? "num" : ""}>{h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr key={String(r[0])}>{r.map((c, i) => <td key={i} className={i ? "num" : ""}>{c}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </details>
  );
}

export interface LineSeries { label: string; short?: string; values: (number | null)[]; target?: number }

/** Percentages over time (0–100 %), up to two series, one shared axis. */
export function PercentLines({ labels, series, empty }: { labels: string[]; series: LineSeries[]; empty: string }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const has = series.some((s) => s.values.some((v) => v !== null));
  const H = 220, M = { l: 40, r: 100, t: 10, b: 26 };
  const x = (i: number) => M.l + (labels.length < 2 ? 0.5 : i / (labels.length - 1)) * (W - M.l - M.r);
  const y = (v: number) => M.t + (1 - v / 100) * (H - M.t - M.b);
  const colors = series.map((_, i) => SERIES[i]);
  return (
    <div>
      {series.length > 1 && <Legend items={series.map((s, i) => ({ label: s.label + (s.target ? ` (target ${s.target}%)` : ""), color: colors[i] }))} />}
      <div ref={ref} className="relative w-full min-w-0 overflow-hidden" onMouseLeave={() => setHover(null)}>
        {!has ? <p className="py-8 text-center text-sm text-gray-500">{empty}</p> : (
          <svg width={W} height={H} role="img" aria-label={series.map((s) => s.label).join(" and ") + " by month"}>
            {[0, 25, 50, 75, 100].map((t) => (
              <g key={t}>
                <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? BASE : GRID} strokeWidth={1} />
                <text x={M.l - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{t}%</text>
              </g>
            ))}
            {labels.map((l, i) => <text key={l} x={x(i)} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>{l}</text>)}
            {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={H - M.b} stroke={BASE} strokeWidth={1} />}
            {series.map((s, si) => {
              const pts = s.values.map((v, i) => (v === null ? null : [x(i), y(v)] as const));
              const d = pts.map((p, i) => (p ? `${i === 0 || !pts[i - 1] ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}` : "")).join("");
              const lastI = s.values.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1);
              return (
                <g key={s.label}>
                  <path d={d} fill="none" stroke={colors[si]} strokeWidth={2} strokeLinejoin="round" />
                  {pts.map((p, i) => p && <circle key={i} cx={p[0]} cy={p[1]} r={4} fill={colors[si]} stroke={SURFACE} strokeWidth={2} />)}
                  {lastI >= 0 && (
                    <text x={x(lastI) + 8} y={y(s.values[lastI]!) + 4 + (si === 1 && series[0].values[lastI] !== null && Math.abs(series[0].values[lastI]! - s.values[lastI]!) < 8 ? 12 : 0)}
                      fontSize={11} fill={INK2}>{s.values[lastI]!.toFixed(0)}%{series.length > 1 ? ` ${s.short ?? s.label}` : ""}</text>
                  )}
                </g>
              );
            })}
            {labels.map((l, i) => (
              <rect key={l} x={x(i) - (W - M.l - M.r) / Math.max(labels.length - 1, 1) / 2} y={M.t} height={H - M.t - M.b}
                width={(W - M.l - M.r) / Math.max(labels.length - 1, 1)} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
            ))}
          </svg>
        )}
        {has && hover !== null && (
          <Tooltip x={x(hover)} y={M.t + 4} w={W}>
            <div className="mb-0.5 font-semibold">{labels[hover]}</div>
            {series.map((s, si) => (
              <div key={s.label} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1 whitespace-nowrap"><span className="inline-block h-2 w-2 rounded-sm" style={{ background: colors[si] }} />{s.label}</span>
                <b className="tabular-nums">{s.values[hover] === null ? "—" : `${s.values[hover]!.toFixed(1)}%`}</b>
              </div>
            ))}
          </Tooltip>
        )}
      </div>
      <TableView head={["Month", ...series.map((s) => s.label)]}
        rows={labels.map((l, i) => [l, ...series.map((s) => (s.values[i] === null ? "—" : `${s.values[i]!.toFixed(1)}%`))])} />
    </div>
  );
}

/** One series of amounts over time as columns (e.g. unplanned downtime hours per week). */
export function Columns({ rows, unit, empty }: { rows: { label: string; value: number; note?: string }[]; unit: string; empty: string }) {
  const [ref, W] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 200, M = { l: 40, r: 8, t: 10, b: 26 };
  const max = niceMax(Math.max(0, ...rows.map((r) => r.value)));
  const band = (W - M.l - M.r) / Math.max(rows.length, 1);
  const bw = Math.min(40, Math.max(6, band - 2));
  const y = (v: number) => M.t + (1 - v / max) * (H - M.t - M.b);
  const every = Math.ceil(rows.length / Math.max(1, Math.floor((W - M.l - M.r) / 56)));
  return (
    <div>
      <div ref={ref} className="relative w-full min-w-0 overflow-hidden" onMouseLeave={() => setHover(null)}>
        {!rows.length ? <p className="py-8 text-center text-sm text-gray-500">{empty}</p> : (
          <svg width={W} height={H} role="img" aria-label={`Columns in ${unit}`}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={M.l} x2={W - M.r} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? BASE : GRID} />
                <text x={M.l - 6} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill={MUTED}>{+(max * f).toFixed(1)}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = M.l + band * i + band / 2, top = y(r.value), h = Math.max(0, y(0) - top);
              return (
                <g key={r.label} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                  <rect x={M.l + band * i} y={M.t} width={band} height={H - M.t - M.b} fill="transparent" />
                  {h > 0 && <path d={`M${cx - bw / 2},${y(0)}V${top + Math.min(4, h)}q0,-4 4,-4H${cx + bw / 2 - 4}q4,0 4,4V${y(0)}Z`}
                    fill={SERIES[0]} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  {i % every === 0 && <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill={MUTED}>{r.label}</text>}
                </g>
              );
            })}
          </svg>
        )}
        {hover !== null && rows[hover] && (
          <Tooltip x={M.l + band * hover + band / 2} y={M.t + 4} w={W}>
            <div className="font-semibold">{rows[hover].label}</div>
            <div className="tabular-nums">{rows[hover].value.toFixed(1)} {unit}{rows[hover].note ? ` · ${rows[hover].note}` : ""}</div>
          </Tooltip>
        )}
      </div>
      <TableView head={["Period", unit, ""]} rows={rows.map((r) => [r.label, r.value.toFixed(1), r.note ?? ""])} />
    </div>
  );
}

/** Equipment state per category: available / standby / unavailable as one horizontal bar per category (counts). */
export function StatusBars({ rows }: { rows: { label: string; available: number; standby: number; unavailable: number }[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const parts = [
    { key: "available", label: "Available", color: "#0ca30c" },
    { key: "standby", label: "Standby", color: "#86b6ef" },
    { key: "unavailable", label: "Unavailable", color: "#d03b3b" },
  ] as const;
  const max = Math.max(1, ...rows.map((r) => r.available + r.standby + r.unavailable));
  return (
    <div>
      <Legend items={parts.map((p) => ({ label: p.label, color: p.color }))} />
      <ul className="space-y-2">
        {rows.map((r) => {
          const total = r.available + r.standby + r.unavailable;
          return (
            <li key={r.label} className="relative" onMouseEnter={() => setHover(r.label)} onMouseLeave={() => setHover(null)} onClick={() => setHover(r.label)}>
              <div className="flex justify-between gap-2 text-xs" style={{ color: INK2 }}>
                <span className="truncate">{r.label}</span>
                <span className="shrink-0 tabular-nums">{r.available}/{total} available{r.unavailable ? <b className="text-crit"> · {r.unavailable} down</b> : null}</span>
              </div>
              <div className="mt-1 flex h-3 gap-[2px]" style={{ width: `${(total / max) * 100}%`, minWidth: 24 }}>
                {parts.map((p) => r[p.key] > 0 && (
                  <div key={p.key} className="h-3 first:rounded-l last:rounded-r" style={{ flex: r[p.key], background: p.color }} />
                ))}
              </div>
              {hover === r.label && (
                <div className="pointer-events-none absolute right-0 top-0 z-10 -translate-y-full rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs shadow-md">
                  <b>{r.label}</b> · {r.available} available · {r.standby} standby · {r.unavailable} unavailable
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <TableView head={["Category", "Available", "Standby", "Unavailable"]} rows={rows.map((r) => [r.label, r.available, r.standby, r.unavailable])} />
    </div>
  );
}
