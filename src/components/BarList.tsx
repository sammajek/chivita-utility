/** Horizontal single-series bars with value labels (no legend needed for one series). */
export function BarList({ rows, unit, empty }: { rows: { label: string; value: number; note?: string }[]; unit: string; empty: string }) {
  const max = Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${r.value.toFixed(1)} ${unit}${r.note ? ` · ${r.note}` : ""}`}>
          <div className="flex justify-between gap-2 text-xs text-gray-700">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">{r.value.toFixed(1)} {unit}{r.note ? ` · ${r.note}` : ""}</span>
          </div>
          <div className="mt-1 h-2 rounded bg-gray-100">
            <div className="h-2 rounded bg-brand-blue" style={{ width: `${max ? Math.max(2, (r.value / max) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function StatTile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "warn" | "crit" | "ok" }) {
  const color = { default: "text-gray-900", warn: "text-warn", crit: "text-crit", ok: "text-ok" }[tone];
  return (
    <div className="card">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
