import Link from "next/link";
import { can, requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos, lagosDate } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { saveServices } from "./actions";

export const dynamic = "force-dynamic";

interface Row {
  asset_id: string; code: string; name: string; area: string; op_state: string; hours: number | null; read_at: string | null;
  interval_id: string; interval_hours: number; warn_before_hours: number; last_service_hours: number | null; last_service_on: string | null;
  due_at_hours: number | null; hours_left: number | null; status: "ok" | "due_soon" | "overdue" | "no_baseline" | "no_counter";
}

const STATUS: Record<Row["status"], { text: string; cls: string }> = {
  ok: { text: "OK", cls: "bg-green-100 text-ok" },
  due_soon: { text: "Due soon", cls: "bg-amber-100 text-warn" },
  overdue: { text: "Overdue", cls: "bg-red-100 text-crit font-semibold" },
  no_baseline: { text: "Last service needed", cls: "bg-amber-100 text-warn" },
  no_counter: { text: "No hours logged", cls: "bg-gray-100 text-gray-600" },
};
const n0 = (v: number | null) => (v === null ? "–" : Math.round(Number(v)).toLocaleString());

/** Running-hours services vs the calendar PM: each machine's counter, services due by hours, and data problems. */
export default async function HoursCrossCheck({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const area = sp.area === "U1" || sp.area === "U2" ? sp.area : "";
  const supabase = await createClient();
  const [{ data }, { data: fl }] = await Promise.all([
    supabase.rpc("running_hours_overview"),
    supabase.from("flags").select("asset_id, title, detail, severity, raised_at").in("kind", ["hours_check", "hours_service_due"]).is("resolved_at", null).order("raised_at", { ascending: false }),
  ]);
  const rows = ((data ?? []) as Row[]).filter((r) => !area || r.area === area);
  const flags = (fl ?? []) as { asset_id: string; title: string; detail: string | null; severity: string; raised_at: string }[];
  const machines = [...new Map(rows.map((r) => [r.asset_id, r])).values()];
  const canEdit = can(profile, "engineer_tasks");
  const today = lagosDate(new Date());
  const count = (s: Row["status"]) => machines.filter((m) => rows.some((r) => r.asset_id === m.asset_id && r.status === s)).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Running-Hours Cross-Check</h1>
        <p className="page-sub">Compressor services fall due by calendar (PM schedule) <b>or</b> by running hours, whichever comes first.
          <Link href="/pm" className="ml-2 text-brand-blue">← Preventive Maintenance</Link></p>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {[["", "Both areas"], ["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
          <Link key={v} href={v ? `/pm/hours?area=${v}` : "/pm/hours"} className={`tab ${area === v ? "tab-on" : ""}`}>{l}</Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(["overdue", "due_soon", "no_baseline", "no_counter"] as const).map((s) => (
          <div key={s} className="card">
            <div className="text-xs font-medium uppercase tracking-wide text-gray-500">{STATUS[s].text}</div>
            <div className={`mt-1 text-2xl font-bold tabular-nums ${s === "overdue" && count(s) ? "text-crit" : count(s) ? "text-warn" : "text-gray-900"}`}>{count(s)}</div>
            <div className="text-xs text-gray-500">machine{count(s) === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>

      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">How the Cross-Check Works</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-gray-700">
          <li>Running hours come from the equipment registers (the Running Hours counter).</li>
          <li>When a running-hours PM task (e.g. the 4000 h service) is recorded done on the PM page, the service is also recorded at the machine’s last counter reading, so its hours clock restarts. A bigger service restarts the smaller ones too (8000 h covers 4000 h and 2000 h).</li>
          <li>A service is <b>due soon</b> within its warning margin (default 200 h) and <b>overdue</b> once the counter passes it. Both raise flags.</li>
          <li>Flags are also raised when the data can’t be trusted: no last service known; running hours went down or rose faster than the clock; hours not logged for 7+ days; or a service entered at more hours than the counter showed.</li>
        </ul>
      </details>

      {machines.length === 0 && <p className="card text-sm text-gray-500">No machines with running-hours services in this area.</p>}

      {machines.map((m) => {
        const mine = rows.filter((r) => r.asset_id === m.asset_id);
        const mflags = flags.filter((f) => f.asset_id === m.asset_id);
        return (
          <section key={m.asset_id} className="card space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-semibold"><Link href={`/equipment/${encodeURIComponent(m.code)}`} className="text-brand-blue">{m.code}</Link> {m.name}</h2>
              <span className="text-sm">Counter: <b className="tabular-nums">{n0(m.hours)} h</b>
                <span className="text-xs text-gray-500">{m.read_at ? ` · ${formatLagos(m.read_at)}` : ""} · {m.area}{m.op_state !== "available" ? ` · ${m.op_state}` : ""}</span></span>
            </div>
            {mflags.length > 0 && (
              <ul className="space-y-1">
                {mflags.map((f) => (
                  <li key={f.title} className={`rounded px-2 py-1 text-xs ${f.severity === "info" ? "bg-gray-50 text-gray-700" : "bg-amber-50 text-warn"}`}>
                    ⚠ <b>{f.title}</b>{f.detail ? ` – ${f.detail}` : ""}
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={saveServices} submit="Save services" readOnly={!canEdit} className="space-y-2">
              <div className="table-wrap">
                <table className="data-table min-w-[720px] text-sm">
                  <thead><tr><th>Service</th><th>Status</th><th className="num">Last service</th><th className="num">Due at</th><th className="num">Hours left</th>
                    {canEdit && <th>Record a service: hours · date</th>}</tr></thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.interval_id}>
                        <td className="whitespace-nowrap font-medium">{r.interval_hours.toLocaleString()} h</td>
                        <td><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-xs ${STATUS[r.status].cls}`}>{STATUS[r.status].text}</span></td>
                        <td className="num whitespace-nowrap">{r.last_service_hours === null ? "–" : `${n0(r.last_service_hours)} h`}<div className="text-xs text-gray-500">{r.last_service_on ?? ""}</div></td>
                        <td className="num">{r.due_at_hours === null ? "–" : `${n0(r.due_at_hours)} h`}</td>
                        <td className={`num ${r.hours_left !== null && r.hours_left < 0 ? "font-semibold text-crit" : ""}`}>{r.hours_left === null ? "–" : `${n0(r.hours_left)} h`}</td>
                        {canEdit && (
                          <td>
                            <input type="hidden" name="interval_id" value={r.interval_id} />
                            <div className="flex gap-1">
                              <input name={`hours_${r.interval_id}`} inputMode="decimal" placeholder="hours" className="input w-28 py-1.5" />
                              <input name={`date_${r.interval_id}`} type="date" max={today} className="input w-40 py-1.5" />
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canEdit && <input name="note" className="input py-2" placeholder="Note (optional), e.g. last service before the app, from the service report" />}
            </ActionForm>
          </section>
        );
      })}
    </div>
  );
}
