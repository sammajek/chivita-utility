import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { loadDashboard } from "@/lib/data/dashboard";
import { addDays, formatLagos, lagosDate, lagosInstant, SHIFT_LABELS, shiftAt } from "@/lib/time";
import { BarList, StatTile } from "@/components/BarList";

export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const h = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} h`);

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ days?: string; area?: string; denied?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const area = sp.area === "U1" || sp.area === "U2" ? sp.area : null;
  const now = new Date();
  const to = lagosInstant(addDays(lagosDate(now), 1), 0);
  const from = lagosInstant(addDays(lagosDate(now), 1 - days), 0);
  const d = await loadDashboard(from, to, area);
  const shift = shiftAt(now);
  const link = (o: Record<string, string>) => `/?${new URLSearchParams({ days: String(days), ...(area ? { area } : {}), ...o })}`;

  return (
    <div className="space-y-6">
      {sp.denied && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">You don&apos;t have access to that page.</p>}
      <section className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Utility section overview</h1>
          <p className="text-sm text-gray-600">{formatLagos(now)} (Lagos) · {SHIFT_LABELS[shift.shift]} · signed in as {profile.full_name}</p>
        </div>
        {d.hasDemo && <span className="rounded bg-purple-100 px-2 py-1 text-xs font-bold uppercase text-purple-700">Includes DEMO data</span>}
      </section>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Readings on time today" value={pct(d.compliance.pct)} sub={`${d.compliance.filled} of ${d.compliance.due} slots due so far`}
          tone={d.compliance.pct === null ? "default" : d.compliance.pct >= 95 ? "ok" : d.compliance.pct >= 80 ? "warn" : "crit"} />
        <StatTile label="Open flags" value={String(d.openFlags)} sub={`${d.criticalFlags} critical`} tone={d.criticalFlags ? "crit" : d.openFlags ? "warn" : "ok"} />
        <StatTile label="Out of spec (24 h)" value={String(d.outOfSpec24h)} sub="values outside the standard" tone={d.outOfSpec24h ? "warn" : "ok"} />
        <StatTile label="Open downtime" value={String(d.openDowntime)} sub="events not closed" tone={d.openDowntime ? "warn" : "ok"} />
      </section>

      <section className="card">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">On duty now</h2>
          <Link href="/duty" className="text-sm text-brand-blue">Duty register →</Link>
        </div>
        <p className="mt-1 text-sm">
          {d.onDuty.length ? d.onDuty.map((p) => `${p.name} (${p.areas.join("+")})`).join(", ") : "Nobody is checked in."}
        </p>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Maintenance KPIs</h2>
          <div className="flex flex-wrap gap-1 text-sm">
            {[7, 30, 90].map((n) => (
              <Link key={n} href={link({ days: String(n) })} className={`rounded border px-2 py-1 ${n === days ? "border-brand-blue bg-blue-50" : ""}`}>{n} days</Link>
            ))}
            {[["", "Both areas"], ["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
              <Link key={v} href={`/?${new URLSearchParams({ days: String(days), ...(v ? { area: v } : {}) })}`}
                className={`rounded border px-2 py-1 ${(area ?? "") === v ? "border-brand-blue bg-blue-50" : ""}`}>{l}</Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile label="Breakdowns" value={String(d.fleet.events)} sub={`last ${days} days`} />
          <StatTile label="Unplanned downtime" value={h(d.fleet.unplannedHours)} />
          <StatTile label="MTTR" value={h(d.fleet.mttr)} sub="breakdown hours ÷ breakdowns" />
          <StatTile label="Availability" value={pct(d.fleet.availability === null ? null : d.fleet.availability * 100)} sub="of equipment with downtime" />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="card">
            <h3 className="mb-3 font-semibold">Downtime by failure mode (Pareto)</h3>
            <BarList rows={d.pareto.map((p) => ({ label: p.label, value: p.hours, note: `${p.events}×` }))} unit="h" empty="No breakdowns in this period." />
          </div>
          <div className="card">
            <h3 className="mb-3 font-semibold">Unplanned downtime per week</h3>
            <BarList rows={d.trend.map((t) => ({ label: `Week of ${t.label}`, value: t.hours, note: `${t.events}×` }))} unit="h" empty="No breakdowns in this period." />
          </div>
        </div>

        <div className="card overflow-x-auto">
          <h3 className="mb-2 font-semibold">Per equipment</h3>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500">
              <tr><th className="py-1">Equipment</th><th>Breakdowns</th><th>Down (h)</th><th>MTTR</th><th>MTBF</th><th>Availability</th></tr>
            </thead>
            <tbody className="tabular-nums">
              {d.kpis.map((k) => (
                <tr key={k.asset_id} className="border-t">
                  <td className="py-1.5"><b>{k.code}</b> <span className="text-gray-500">{k.name}</span></td>
                  <td>{k.failures}</td>
                  <td>{k.unplanned_hours.toFixed(1)}</td>
                  <td>{h(k.mttr)}</td>
                  <td title={k.operating_hours_estimated ? "Estimated: no running-hours counter readings" : `${k.operating_hours.toFixed(0)} running hours from counter`}>
                    {h(k.mtbf)}{k.operating_hours_estimated && k.mtbf !== null ? "*" : ""}
                  </td>
                  <td>{pct(k.availability === null ? null : k.availability * 100)}</td>
                </tr>
              ))}
              {d.kpis.length === 0 && <tr><td colSpan={6} className="py-2 text-gray-500">No downtime recorded in this period.</td></tr>}
            </tbody>
          </table>
          <details className="mt-3 text-xs text-gray-600">
            <summary className="cursor-pointer font-medium">How these are calculated</summary>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li><b>MTTR</b> = total unplanned breakdown hours ÷ number of unplanned breakdowns.</li>
              <li><b>MTBF</b> = operating hours of that equipment ÷ its breakdowns. Operating hours come from the running-hours counters on the registers; * means no counter readings, so scheduled hours minus downtime were used.</li>
              <li><b>Availability</b> = (scheduled hours − unplanned downtime) ÷ scheduled hours, with 24 h/day scheduled. Planned maintenance is shown separately and not counted as unavailability.</li>
              <li>Unlike the Excel dashboard, MTBF is per equipment, not total calendar hours across the whole fleet.</li>
            </ul>
          </details>
        </div>
      </section>
    </div>
  );
}
