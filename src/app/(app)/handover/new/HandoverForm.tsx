"use client";

import { useActionState, useState } from "react";
import { HANDOVER_GROUPS, MACHINE_STATUS, type HandoverContent, type MachineItem, type MachineStatus } from "@/lib/handover";
import { submitHandover, type Msg } from "../actions";

const Field = ({ name, label, value, rows = 1, mode }: { name: string; label: string; value: string; rows?: number; mode?: "numeric" | "decimal" }) => (
  <label className="block">
    <span className="text-xs font-medium text-gray-600">{label}</span>
    {rows > 1 ? <textarea name={name} defaultValue={value} rows={rows} className="input text-sm" />
      : <input name={name} defaultValue={value} inputMode={mode} pattern={mode === "numeric" ? "[0-9]*" : undefined} className="input text-sm" />}
  </label>
);

const TONE: Record<string, string> = { running: "border-green-600 bg-green-600 text-white", standby: "border-brand-blue bg-brand-blue text-white", fault: "border-crit bg-crit text-white" };

/** One machine with tick-boxes Running / Standby / Maint.-fault (one at a time; tap again to clear). */
function MachineRow({ prefix, item }: { prefix: string; item: MachineItem }) {
  const [st, setSt] = useState<MachineStatus>(item.status);
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <input type="hidden" name={`${prefix}:${item.code}`} value={st} />
      <input type="hidden" name={`${prefix}-name:${item.code}`} value={item.name} />
      <span className="min-w-0 text-sm"><b>{item.code}</b> <span className="text-gray-500">{item.name}</span></span>
      <div className="flex gap-1" role="group" aria-label={`${item.code} status`}>
        {MACHINE_STATUS.map((m) => {
          const on = st === m.v;
          return (
            <button key={m.v} type="button" aria-pressed={on} onClick={() => setSt(on ? "" : m.v)}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold ${on ? TONE[m.v] : "border-gray-300 bg-white text-gray-700"}`}>
              <span aria-hidden className={`inline-flex h-4 w-4 items-center justify-center rounded border ${on ? "border-white" : "border-gray-400"}`}>{on ? "✓" : ""}</span>
              {m.label}
            </button>
          );
        })}
      </div>
    </li>
  );
}

function MachineGroup({ prefix, label, items, note }: { prefix: string; label: string; items: MachineItem[]; note: string }) {
  return (
    <div className="py-3">
      <b className="text-sm">{label}</b>
      <ul className="divide-y divide-gray-100">{items.map((i) => <MachineRow key={i.code} prefix={prefix} item={i} />)}</ul>
      <Field name={`${prefix}-note`} label="Maintenance / fault details" value={note} />
    </div>
  );
}

/** The UTILITY HANDOVER REPORT for the whole shift, pre-filled from the app; submitting it checks the writer out. */
export function HandoverForm({ prefill, checklist, openFlags }: { prefill: Omit<HandoverContent, "checklist">; checklist: string[]; openFlags: number }) {
  const [state, action, pending] = useActionState<Msg, FormData>(submitHandover, {});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="checklist_items" value={JSON.stringify(checklist)} />
      <section className="card space-y-1">
        <h2 className="section-title">Equipment</h2>
        <p className="text-xs text-gray-500">Ticked from the equipment states in the app. Tap to correct: Running, Standby or Maintenance / fault (tap again to clear).</p>
        <div className="divide-y">
          {HANDOVER_GROUPS.map((g) => {
            const gs = prefill.groups[g.key];
            return gs?.items?.length
              ? <MachineGroup key={g.key} prefix={`m:${g.key}`} label={g.label} items={gs.items} note={gs.note ?? ""} />
              : (
                <div key={g.key} className="grid gap-2 py-3 sm:grid-cols-[9rem_1fr_1fr_1fr] sm:items-start">
                  <b className="pt-5 text-sm">{g.label}</b>
                  <Field name={`g:${g.key}:running`} label="Running" value={gs?.running ?? ""} />
                  <Field name={`g:${g.key}:standby`} label="Standby" value={gs?.standby ?? ""} />
                  <Field name={`g:${g.key}:faults`} label="Maintenance / faults" value={gs?.faults ?? ""} />
                </div>
              );
          })}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Fuel usage (PNG / CNG / diesel)</h2>
        <Field name="fuel" label="From the 07:00 report where available" value={prefill.fuel} rows={2} />
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Water treatment plant</h2>
        {prefill.wtp.items?.length ? <MachineGroup prefix="w" label="Other water treatment equipment" items={prefill.wtp.items} note={prefill.wtp.note ?? ""} /> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field name="wtp:standby" label="Standby" value={prefill.wtp.standby} />
            <Field name="wtp:faults" label="Maintenance / faults" value={prefill.wtp.faults} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field name="wtp:raw_count" label="No. of raw water pumps running" value={prefill.wtp.raw_count ?? ""} mode="numeric" />
          <Field name="wtp:treated_count" label="No. of treated water pumps running" value={prefill.wtp.treated_count ?? ""} mode="numeric" />
          <Field name="wtp:ph_raw" label="pH – raw water" value={prefill.wtp.ph_raw ?? ""} mode="decimal" />
          <Field name="wtp:ph_treated" label="pH – treated water" value={prefill.wtp.ph_treated ?? ""} mode="decimal" />
          <Field name="wtp:raw_level" label="Water level – raw water" value={prefill.wtp.raw_level} />
          <Field name="wtp:treated_level" label="Water level – treated water" value={prefill.wtp.treated_level} />
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Caustic mixing</h2>
        <Field name="caustic" label="Status / quantity mixed" value={prefill.caustic} rows={2} />
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">End-of-shift checklist</h2>
        <p className="text-xs text-gray-500">{openFlags} open flag(s) will be passed on with this handover.</p>
        <ul className="divide-y">
          {checklist.map((item, i) => (
            <li key={item} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">{item}</span>
                <div className="flex gap-1">
                  {[["yes", "Yes"], ["no", "No"], ["na", "N/A"]].map(([v, l]) => (
                    <label key={v} className={`tab cursor-pointer ${answers[i] === v ? (v === "no" ? "border-crit bg-crit text-white" : "tab-on") : ""}`}>
                      <input type="radio" name={`ck:${i}`} value={v} className="sr-only" onChange={() => setAnswers({ ...answers, [i]: v })} />{l}
                    </label>
                  ))}
                </div>
              </div>
              {answers[i] === "no" && <input name={`cn:${i}`} className="input text-sm" placeholder="What is outstanding and who is following up? *" required minLength={3} />}
            </li>
          ))}
        </ul>
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Footnote</h2>
        <textarea name="footnote" rows={4} className="input" placeholder="Anything else the next shift must know: jobs in progress, vendor visits, safety issues…" />
      </section>

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Submitting…" : "Submit the shift handover and check out"}</button>
    </form>
  );
}
