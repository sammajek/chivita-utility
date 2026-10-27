import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos, lagosDate } from "@/lib/time";
import { FREQ_LABEL, type PmFrequency } from "@/lib/pm";
import { serviceStatus } from "@/lib/hours";
import { namesFor } from "@/lib/data/pm";
import { ActionForm } from "@/components/ActionForm";
import { EvidenceList } from "@/components/EvidenceList";
import { recordService, updateInterval, updateSpecs } from "../actions";
import { StateBadge } from "../StateBadge";
import { StateForm } from "./StateForm";

export const dynamic = "force-dynamic";

interface Interval {
  id: string; interval_hours: number; warn_before_hours: number; service_name: string;
  last_service_hours: number | null; last_service_on: string | null; active: boolean;
}

const SERVICE_STYLE = { ok: "text-ok", due_soon: "text-warn", overdue: "text-crit", no_baseline: "text-gray-500", no_reading: "text-gray-500" };

export default async function EquipmentDetail({ params }: { params: Promise<{ code: string }> }) {
  const profile = await requireProfile();
  const code = decodeURIComponent((await params).code);
  const supabase = await createClient();
  const { data } = await supabase.from("assets").select("*, category:asset_categories(name)").eq("code", code).maybeSingle();
  if (!data) notFound();
  const a = data as Record<string, string | number | null> & { id: string; op_state: string; op_reason: string | null; op_since: string | null; category: { name: string } | null };

  const [{ data: states }, { data: intervals }, { data: hours }, { data: pm }, { data: dts }, { data: aliases }] = await Promise.all([
    supabase.from("asset_states").select("id, state, reason, note, started_at, ended_at, recorded_by_id").eq("asset_id", a.id).order("started_at", { ascending: false }).limit(20),
    supabase.from("service_intervals").select("id, interval_hours, warn_before_hours, service_name, last_service_hours, last_service_on, active").eq("asset_id", a.id).order("interval_hours"),
    supabase.rpc("asset_running_hours", { p_asset: a.id }),
    supabase.from("pm_tasks").select("id, frequency, register_sn, tasks, hours_interval, document_no").eq("asset_id", a.id).eq("active", true).order("frequency"),
    supabase.from("downtime_events").select("id, event_no, start_at, end_at, downtime_type, failure_mode, status, followup_stage").eq("asset_id", a.id).is("voided_at", null).order("start_at", { ascending: false }).limit(10),
    supabase.from("asset_aliases").select("alias, source").eq("asset_id", a.id),
  ]);
  const h = ((hours ?? []) as { hours: number; read_at: string }[])[0] ?? null;
  const st = (states ?? []) as { id: string; state: string; reason: string | null; note: string | null; started_at: string; ended_at: string | null; recorded_by_id: string | null }[];
  const names = await namesFor(st.map((s) => s.recorded_by_id));
  const canAct = profile.active && profile.role !== "viewer";
  const isEng = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const isAdmin = ["section_manager", "admin"].includes(profile.role);
  const today = lagosDate(new Date());
  const spec = (l: string, v: unknown) => <div><dt className="text-xs text-gray-500">{l}</dt><dd className="text-sm">{v === null || v === undefined || v === "" ? "—" : String(v)}</dd></div>;

  return (
    <div className="space-y-4">
      <Link href="/equipment" className="text-sm text-brand-blue">← Equipment</Link>
      <div className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{a.code} · {a.name}</h1>
          <StateBadge state={a.op_state} reason={a.op_reason} />
        </div>
        {a.op_since && <p className="text-xs text-gray-500">Since {formatLagos(a.op_since)}</p>}
        <dl className="grid gap-2 sm:grid-cols-4">
          {spec("Category", a.category?.name)}{spec("Area", a.area)}{spec("PM code", a.pm_code)}{spec("Criticality", a.criticality)}
          {spec("Make", a.make)}{spec("Model", a.model)}{spec("Serial no", a.serial_no)}{spec("Capacity", a.capacity)}
          {spec("Rated output", a.rated_output != null ? `${a.rated_output} ${a.rated_unit ?? ""}` : null)}{spec("Location", a.location)}
          {spec("Year installed", a.year_installed)}{spec("Running hours", h ? `${Math.round(h.hours).toLocaleString()} h (${formatLagos(h.read_at)})` : null)}
        </dl>
        {a.specs && <pre className="whitespace-pre-wrap rounded bg-gray-50 p-2 text-sm">{String(a.specs)}</pre>}
        {(aliases ?? []).length > 0 && <p className="text-xs text-gray-500">Also called: {(aliases ?? []).map((x) => x.alias).join(" · ")}</p>}
      </div>

      {canAct && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Equipment state</h2>
          <p className="text-xs text-gray-500">Standby and unavailable machines are not expected to log readings, so they raise no “missing reading” flags.</p>
          <StateForm assetId={a.id} code={code} current={a.op_state} />
        </section>
      )}

      {(intervals ?? []).length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Running-hours services</h2>
          <p className="text-xs text-gray-500">From the running hours logged in the equipment register. A flag is raised {(intervals as Interval[])[0].warn_before_hours} h before a service is due. Recording a bigger service also resets the smaller ones (e.g. 8000 h covers 4000 h and 2000 h).</p>
          <ul className="divide-y">
            {(intervals as Interval[]).map((i) => {
              const s = serviceStatus(i, h?.hours ?? null);
              return (
                <li key={i.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <b>{i.service_name}</b>
                    <span className={SERVICE_STYLE[s.state]}>{s.label}</span>
                  </div>
                  <p className="text-xs text-gray-500">Last: {i.last_service_hours != null ? `${i.last_service_hours} h on ${i.last_service_on}` : "not recorded"}{!i.active && " · paused"}</p>
                  {canAct && (
                    <ActionForm action={recordService} className="flex flex-wrap items-center gap-2" submit="Record service">
                      <input type="hidden" name="interval_id" value={i.id} /><input type="hidden" name="code" value={code} />
                      <input name="hours" inputMode="decimal" className="input w-32 py-2" placeholder="Hours at service" defaultValue={h ? Math.round(h.hours) : ""} required />
                      <input type="date" name="date" className="input w-40 py-2" defaultValue={today} max={today} required />
                      <input name="note" className="input max-w-xs py-2" placeholder="Note / vendor" />
                    </ActionForm>
                  )}
                  {isEng && (
                    <details className="text-xs"><summary className="cursor-pointer text-gray-500">Settings</summary>
                      <ActionForm action={updateInterval} className="mt-1 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="id" value={i.id} /><input type="hidden" name="code" value={code} />
                        <label>Warn <input name="warn" inputMode="numeric" className="input inline w-20 py-1" defaultValue={i.warn_before_hours} /> h before</label>
                        <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={i.active} /> Active</label>
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="card space-y-2">
        <h2 className="font-semibold">PM tasks</h2>
        {(pm ?? []).length === 0 && <p className="text-sm text-gray-500">No PM tasks linked to this equipment.</p>}
        <ul className="space-y-2 text-sm">
          {(pm ?? []).map((t) => (
            <li key={t.id}><b>{FREQ_LABEL[t.frequency as PmFrequency]}</b> · {t.document_no} S/N {t.register_sn}{t.hours_interval ? ` · ${t.hours_interval} h` : ""}
              <ul className="ml-4 list-disc text-xs text-gray-600">{(t.tasks as string[]).map((x, n) => <li key={n}>{x}</li>)}</ul></li>
          ))}
        </ul>
        <Link href="/pm" className="text-sm text-brand-blue">Open PM →</Link>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Recent downtime</h2>
        {(dts ?? []).length === 0 && <p className="text-sm text-gray-500">None.</p>}
        <ul className="space-y-1 text-sm">
          {(dts ?? []).map((d) => (
            <li key={d.id}><Link href={`/downtime/${d.id}`} className="text-brand-blue">{d.event_no}</Link> · {formatLagos(d.start_at)} · {d.downtime_type} · {d.failure_mode} · {d.status}{d.followup_stage ? ` · ${d.followup_stage.replace("_", " ")}` : ""}</li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">State history</h2>
        {st.length === 0 && <p className="text-sm text-gray-500">No changes recorded yet.</p>}
        <ul className="space-y-1 text-sm">
          {st.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2">
              <StateBadge state={s.state} reason={s.reason} />
              <span className="text-xs text-gray-600">{formatLagos(s.started_at)} → {s.ended_at ? formatLagos(s.ended_at) : "now"} · {names.get(s.recorded_by_id ?? "") ?? "system"}{s.note ? ` · ${s.note}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Photos, manuals &amp; documents</h2>
        <EvidenceList entityType="asset" entityId={a.id} canAdd={canAct} docTypes />
      </section>

      {isAdmin && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Edit PM code &amp; specifications</h2>
          <ActionForm action={updateSpecs} className="grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="asset_id" value={a.id} /><input type="hidden" name="code" value={code} />
            {[["pm_code", "PM code"], ["make", "Make"], ["model", "Model"], ["serial_no", "Serial no"], ["capacity", "Capacity"], ["location", "Location"], ["year_installed", "Year installed"]].map(([k, l]) => (
              <label key={k} className="block"><span className="text-xs text-gray-600">{l}</span>
                <input name={k} defaultValue={a[k] == null ? "" : String(a[k])} className="input py-2" inputMode={k === "year_installed" ? "numeric" : undefined} /></label>
            ))}
            <label className="block"><span className="text-xs text-gray-600">Criticality</span>
              <select name="criticality" defaultValue={a.criticality ?? ""} className="input py-2"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></label>
            <label className="block sm:col-span-3"><span className="text-xs text-gray-600">Specifications (one per line)</span>
              <textarea name="specs" rows={5} defaultValue={a.specs ?? ""} className="input" placeholder={"Motor: 75 kW, 415 V\nFAD: 12.5 m³/min @ 7 bar"} /></label>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
