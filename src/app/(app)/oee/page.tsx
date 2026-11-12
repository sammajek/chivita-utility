import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { assetKpis, oee, performance, quality, type DowntimeEvent } from "@/lib/kpi";
import { addDays, lagosDate, lagosInstant } from "@/lib/time";
import { StatTile } from "@/components/BarList";

export const dynamic = "force-dynamic";

interface Asset { id: string; code: string; name: string; area: string | null; rated_output: number | null; rated_unit: string | null }
interface Inputs { asset_id: string; in_spec: number; judged: number; output: number | null; output_unit: string | null; run_hours: number | null }

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/** Utility OEE per equipment: Availability × Performance × Quality. */
export default async function OeePage({ searchParams }: { searchParams: Promise<{ days?: string; area?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const area = sp.area === "U1" || sp.area === "U2" ? sp.area : null;
  const now = new Date();
  const to = lagosInstant(addDays(lagosDate(now), 1), 0);
  const from = lagosInstant(addDays(lagosDate(now), 1 - days), 0);
  const supabase = await createClient();
  let aq = supabase.from("assets").select("id, code, name, area, rated_output, rated_unit").neq("status", "retired").order("code");
  if (area) aq = aq.eq("area", area);
  const [{ data: a }, { data: inp }, { data: dt }] = await Promise.all([
    aq,
    supabase.rpc("oee_inputs", { p_from: from.toISOString(), p_to: to.toISOString() } as never),
    supabase.from("downtime_events").select("asset_id, downtime_type, start_at, end_at, override_hours, immediate_stop, planned_hours")
      .is("voided_at", null).gte("start_at", new Date(from.getTime() - 30 * 86_400_000).toISOString()).limit(5000),
  ]);
  const assets = (a ?? []) as Asset[];
  const inputs = new Map(((inp ?? []) as Inputs[]).map((i) => [i.asset_id, i]));
  const events = (dt ?? []) as DowntimeEvent[];
  // running hours from the counter go in as two points so assetKpis uses them; otherwise it estimates
  const counters = new Map<string, { at: string; value: number }[]>();
  for (const [id, i] of inputs) if (i.run_hours !== null) counters.set(id, [{ at: "a", value: 0 }, { at: "b", value: Number(i.run_hours) }]);
  const kpis = new Map(assetKpis(assets.map((x) => x.id), events, counters, from, to, now).map((k) => [k.asset_id, k]));

  const rows = assets.map((x) => {
    const k = kpis.get(x.id)!;
    const i = inputs.get(x.id);
    const p = performance(i?.output != null ? Number(i.output) : null, x.rated_output != null ? Number(x.rated_output) : null, k.operating_hours);
    const q = quality(Number(i?.in_spec ?? 0), Number(i?.judged ?? 0));
    const why = x.rated_output == null ? "needs rated output" : i?.output == null ? "no output meter readings" : null;
    return { x, k, i, p, q, o: oee(k.availability, p, q), why };
  }).filter((r) => r.q !== null || r.k.failures > 0 || r.p !== null);
  const full = rows.filter((r) => r.o !== null);
  const avg = (xs: (number | null)[]) => { const v = xs.filter((n): n is number => n !== null); return v.length ? v.reduce((t, n) => t + n, 0) / v.length : null; };
  const link = (o: Record<string, string>) => `/oee?${new URLSearchParams({ days: String(days), ...(area ? { area } : {}), ...o })}`;
  const isAdmin = ["admin", "section_manager"].includes(profile.role);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Utility OEE</h1>
          <p className="page-sub">OEE = Availability × Performance × Quality, per equipment, for the last {days} days.</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {[7, 30, 90].map((d) => <Link key={d} href={link({ days: String(d) })} className={`tab ${d === days ? "tab-on" : ""}`}>{d} days</Link>)}
          {[["", "Both areas"], ["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
            <Link key={v} href={`/oee?${new URLSearchParams({ days: String(days), ...(v ? { area: v } : {}) })}`} className={`tab ${(area ?? "") === v ? "tab-on" : ""}`}>{l}</Link>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Average OEE" value={pct(avg(full.map((r) => r.o)))} sub={`${full.length} equipment with all three factors`} />
        <StatTile label="Average availability" value={pct(avg(rows.map((r) => r.k.availability)))} sub="unplanned downtime only" />
        <StatTile label="Average performance" value={pct(avg(rows.map((r) => r.p)))} sub="output ÷ rated output" />
        <StatTile label="Average quality" value={pct(avg(rows.map((r) => r.q)))} sub="readings in spec" />
      </section>

      <div className="table-wrap">
        <table className="data-table min-w-[760px]">
          <thead><tr><th>Equipment</th><th className="num">Availability</th><th className="num">Performance</th><th className="num">Quality</th><th className="num">OEE</th><th>Notes</th></tr></thead>
          <tbody>
            {rows.map(({ x, k, i, p, q, o, why }) => (
              <tr key={x.id}>
                <td><Link href={`/equipment/${x.code}`} className="font-medium text-brand-blue">{x.code}</Link> <span className="text-gray-500">{x.name}</span></td>
                <td className="num">{pct(k.availability)}</td>
                <td className="num" title={i?.output != null ? `${Number(i.output).toLocaleString()} ${i.output_unit ?? ""} in ${k.operating_hours.toFixed(0)} h at ${x.rated_output} ${x.rated_unit ?? ""}` : undefined}>{pct(p)}</td>
                <td className="num" title={i ? `${i.in_spec} of ${i.judged} readings in spec` : undefined}>{pct(q)}</td>
                <td className="num font-semibold">{pct(o)}</td>
                <td className="text-xs text-gray-500">{why ?? (k.operating_hours_estimated ? "running hours estimated" : "")}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-gray-500">No readings or downtime in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      <details className="card text-sm text-gray-700" open={full.length === 0}>
        <summary className="cursor-pointer section-title">How OEE Is Calculated</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li><b>Availability</b> = (scheduled hours − unplanned breakdown hours) ÷ scheduled hours (24 h a day).</li>
          <li><b>Performance</b> = actual output ÷ (rated output per hour × running hours). Output comes from the equipment&apos;s output meter on the Consumption page (for example the boiler steam totaliser in tonnes for a boiler rated in t/h). Running hours come from the register&apos;s running-hours counter, or scheduled hours minus downtime when there is none. Capped at 100 %.</li>
          <li><b>Quality</b> = readings in spec ÷ readings checked against a standard, from the registers.</li>
          <li><b>OEE</b> = Availability × Performance × Quality. It stays blank until all three can be worked out.</li>
          <li>Worked example: 95 % available × 80 % performance × 98 % in spec = <b>74.5 % OEE</b>.</li>
        </ul>
        <p className="mt-2 text-xs text-gray-500">Performance needs each equipment&apos;s rated output (e.g. 3.5 t/h){isAdmin ? <> — enter it under <Link href="/admin?tab=assets" className="text-brand-blue">Admin → Equipment</Link></> : " — the section manager enters it under Admin → Equipment"}, and an output meter whose unit matches (t for t/h, m³ for m³/h).</p>
      </details>
    </div>
  );
}
