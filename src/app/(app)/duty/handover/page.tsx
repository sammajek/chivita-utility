import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, formatLagos, SHIFT_LABELS, shiftAt, shiftWindow, type Shift } from "@/lib/time";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

/** Groups as on the handover sheet of the consumption report, mapped to equipment categories. */
const GROUPS: [string, string[]][] = [
  ["Compressors", ["Air Compressors"]], ["Dryers", ["Air Dryers"]], ["Chillers & cooling towers", ["Chillers"]],
  ["Boilers", ["Boilers"]], ["Water treatment plant", ["Water Treatment", "Filtration", "UV Systems"]],
  ["Boreholes", ["Boreholes"]], ["Degassers", ["Degassers"]], ["Pumps", ["Pumps", "Jet Pumps"]],
  ["Nitrogen generators", ["Nitrogen Generators"]],
];
const LATEST = ["Raw Water Tank Level", "Process Water Tank Level", "Feed Water Tank Level", "Diesel Tank Level", "Chilled Water Tank Level %"];

interface Asset { id: string; code: string; name: string; area: string | null; op_state: string; op_reason: string | null; category: { name: string } | null }

/**
 * UTILITY HANDOVER REPORT (handover sheet of the consumption report), filled in from the app:
 * equipment running / standby / maintenance-faults, fuel use since yesterday 07:00, tank levels,
 * open downtime and flags, and the handover notes of the shift.
 */
export default async function HandoverReport({ searchParams }: { searchParams: Promise<{ date?: string; shift?: string; area?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const cur = shiftAt(new Date());
  const shift: Shift = sp.shift === "day" || sp.shift === "night" ? sp.shift : cur.shift;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : cur.shiftDate;
  const area = sp.area === "U1" || sp.area === "U2" ? sp.area : "";
  const win = shiftWindow(shift, date);
  const supabase = await createClient();

  let aq = supabase.from("assets").select("id, code, name, area, op_state, op_reason, category:asset_categories(name)").neq("status", "retired").order("code");
  if (area) aq = aq.eq("area", area);
  const [{ data: assetData }, { data: sessions }, { data: downtime }, { count: openFlags }, { data: fuel }, { data: params }] = await Promise.all([
    aq,
    supabase.from("duty_sessions").select("checked_in_at, checked_out_at, handover_note, areas, profile:profiles(full_name)").eq("shift_date", date).eq("shift", shift),
    supabase.from("downtime_events").select("id, event_no, start_at, downtime_type, failure_mode, status, followup_stage, asset:assets(code, name, area)")
      .is("voided_at", null).neq("status", "Closed").order("start_at"),
    supabase.from("flags").select("id", { count: "exact", head: true }).is("resolved_at", null),
    supabase.from("meter_usage").select("code, name, unit, used, read_date").in("grp", ["daily"]).eq("read_date", shift === "day" ? date : addDays(date, 1)),
    supabase.from("parameters").select("id, name, unit").in("name", LATEST),
  ]);
  const assets = (assetData ?? []) as unknown as Asset[];
  const pids = (params ?? []).map((p) => p.id);
  const { data: levels } = pids.length
    ? await supabase.from("readings").select("parameter_id, value_num, reading_for, asset:assets(code)").in("parameter_id", pids)
        .lte("reading_for", win.end.toISOString()).is("voided_at", null).order("reading_for", { ascending: false }).limit(200)
    : { data: [] };
  const latest = new Map<string, { v: number; at: string; code: string }>();
  for (const r of (levels ?? []) as unknown as { parameter_id: string; value_num: number | null; reading_for: string; asset: { code: string } | null }[]) {
    const k = `${r.parameter_id}|${r.asset?.code ?? ""}`;
    if (r.value_num !== null && !latest.has(k)) latest.set(k, { v: r.value_num, at: r.reading_for, code: r.asset?.code ?? "" });
  }
  const pname = new Map((params ?? []).map((p) => [p.id, `${p.name}${p.unit && !p.name.includes("%") ? ` (${p.unit})` : ""}`]));
  const dts = ((downtime ?? []) as unknown as { id: string; event_no: string; start_at: string; downtime_type: string; failure_mode: string; status: string; followup_stage: string | null; asset: { code: string; name: string; area: string | null } | null }[])
    .filter((d) => !area || d.asset?.area === area);
  const fuelRows = ((fuel ?? []) as { code: string; name: string; unit: string | null; used: number | null }[]).filter((f) => /GAS|DH|GH/.test(f.code) && f.used !== null);
  const people = (sessions ?? []) as unknown as { checked_in_at: string; checked_out_at: string | null; handover_note: string | null; areas: string[]; profile: { full_name: string } | null }[];

  const list = (xs: Asset[]) => xs.length ? xs.map((a) => a.code + (a.op_reason ? ` (${a.op_reason})` : "")).join(", ") : "—";
  const prev = shift === "day" ? { date: addDays(date, -1), shift: "night" } : { date, shift: "day" };
  const next = shift === "day" ? { date, shift: "night" } : { date: addDays(date, 1), shift: "day" };
  const href = (d: string, s: string) => `/duty/handover?date=${d}&shift=${s}${area ? `&area=${area}` : ""}`;

  return (
    <div className="space-y-4 bg-white">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <Link href="/duty" className="text-sm text-brand-blue">← On duty</Link>
        <div className="flex gap-2 text-sm">
          <Link href={href(prev.date, prev.shift)} className="btn-secondary px-3 py-1">← Previous shift</Link>
          <Link href={href(next.date, next.shift)} className="btn-secondary px-3 py-1">Next shift →</Link>
          {[["", "Both"], ["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
            <Link key={v} href={`/duty/handover?date=${date}&shift=${shift}${v ? `&area=${v}` : ""}`} className={`tab ${area === v ? "tab-on" : ""}`}>{l}</Link>
          ))}
        </div>
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo height={40} />
          <div>
            <h1 className="text-lg font-bold uppercase">Utility handover report</h1>
            <p className="text-sm">Date: <b>{date}</b> · Duty: <b>{SHIFT_LABELS[shift]}</b>{area ? ` · ${area === "U1" ? "Utility 1" : "Utility 2"}` : ""}</p>
          </div>
        </div>
        <div className="text-right text-xs text-gray-600">Generated {formatLagos(new Date())}<br />Equipment state as recorded now<PrintButton /></div>
      </div>

      <table className="w-full border-collapse text-sm">
        <thead><tr className="bg-gray-100"><th className="border p-1 text-left">Equipment</th><th className="border p-1 text-left">Running / available</th><th className="border p-1 text-left">Standby</th><th className="border p-1 text-left">Maintenance / faults</th></tr></thead>
        <tbody>
          {GROUPS.map(([label, cats]) => {
            const xs = assets.filter((a) => cats.includes(a.category?.name ?? ""));
            if (!xs.length) return null;
            return (
              <tr key={label} className="align-top">
                <td className="border p-1 font-semibold">{label}</td>
                <td className="border p-1">{list(xs.filter((a) => a.op_state === "available"))}</td>
                <td className="border p-1">{list(xs.filter((a) => a.op_state === "standby"))}</td>
                <td className="border p-1 text-crit">{list(xs.filter((a) => a.op_state === "unavailable"))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="grid gap-4 sm:grid-cols-2">
        <section>
          <h2 className="text-sm font-semibold">Fuel usage (07:00 report{shift === "night" ? ", next morning" : ""})</h2>
          {fuelRows.length ? (
            <ul className="text-sm">{fuelRows.map((f) => <li key={f.code}>{f.name}: <b>{Math.round(Number(f.used)).toLocaleString()}</b> {f.unit}</li>)}</ul>
          ) : <p className="text-sm text-gray-500">No 07:00 consumption readings for this date yet.</p>}
        </section>
        <section>
          <h2 className="text-sm font-semibold">Tank levels (latest by end of shift)</h2>
          {latest.size ? (
            <ul className="text-sm">{[...latest.entries()].map(([k, x]) => <li key={k}>{pname.get(k.split("|")[0])}{x.code ? ` ${x.code}` : ""}: <b>{x.v}</b> <span className="text-xs text-gray-500">({formatLagos(x.at).slice(-5)})</span></li>)}</ul>
          ) : <p className="text-sm text-gray-500">No readings yet.</p>}
        </section>
      </div>

      <section>
        <h2 className="text-sm font-semibold">Open downtime ({dts.length}) · open flags: {openFlags ?? 0}</h2>
        {dts.length ? (
          <ul className="text-sm">{dts.map((d) => (
            <li key={d.id}>{d.event_no} · {d.asset?.code} {d.asset?.name} · {d.downtime_type} · {d.failure_mode} · since {formatLagos(d.start_at)} · {d.status}{d.followup_stage ? ` · ${d.followup_stage.replace("_", " ")}` : ""}</li>
          ))}</ul>
        ) : <p className="text-sm text-gray-500">None.</p>}
      </section>

      <section>
        <h2 className="text-sm font-semibold">Engineers on duty and handover notes</h2>
        {people.length ? people.map((p, i) => (
          <div key={i} className="border-t py-1 text-sm">
            <b>{p.profile?.full_name}</b> ({p.areas.join(" + ")}) · in {formatLagos(p.checked_in_at).slice(-5)}{p.checked_out_at ? ` · out ${formatLagos(p.checked_out_at).slice(-5)}` : ""}
            {p.handover_note && <p className="whitespace-pre-line">{p.handover_note}</p>}
          </div>
        )) : <p className="text-sm text-gray-500">Nobody checked in for this shift.</p>}
      </section>

      <div className="grid grid-cols-2 gap-8 pt-6 text-sm">
        <div className="border-t pt-1">Utility Engineer / sign</div>
        <div className="border-t pt-1">Manager / sign</div>
      </div>
    </div>
  );
}
