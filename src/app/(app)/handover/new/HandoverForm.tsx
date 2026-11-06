"use client";

import { useActionState, useState } from "react";
import { HANDOVER_GROUPS, type HandoverContent } from "@/lib/handover";
import { submitHandover, type Msg } from "../actions";

const Field = ({ name, label, value, rows = 1 }: { name: string; label: string; value: string; rows?: number }) => (
  <label className="block">
    <span className="text-xs font-medium text-gray-600">{label}</span>
    {rows > 1 ? <textarea name={name} defaultValue={value} rows={rows} className="input text-sm" /> : <input name={name} defaultValue={value} className="input text-sm" />}
  </label>
);

/** The UTILITY HANDOVER REPORT, pre-filled from the app; the engineer checks and completes it, then submits = checks out. */
export function HandoverForm({ prefill, checklist, openFlags }: { prefill: Omit<HandoverContent, "checklist">; checklist: string[]; openFlags: number }) {
  const [state, action, pending] = useActionState<Msg, FormData>(submitHandover, {});
  const [answers, setAnswers] = useState<Record<number, string>>({});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="checklist_items" value={JSON.stringify(checklist)} />
      <section className="card space-y-3">
        <h2 className="section-title">Equipment</h2>
        <p className="text-xs text-gray-500">Filled in from the equipment states in the app. Correct anything that is not right (machine codes or names).</p>
        <div className="divide-y">
          {HANDOVER_GROUPS.map((g) => (
            <div key={g.key} className="grid gap-2 py-3 sm:grid-cols-[9rem_1fr_1fr_1fr] sm:items-start">
              <b className="pt-5 text-sm">{g.label}</b>
              <Field name={`g:${g.key}:running`} label="Running" value={prefill.groups[g.key]?.running ?? ""} />
              <Field name={`g:${g.key}:standby`} label="Standby" value={prefill.groups[g.key]?.standby ?? ""} />
              <Field name={`g:${g.key}:faults`} label="Maintenance / faults" value={prefill.groups[g.key]?.faults ?? ""} />
            </div>
          ))}
        </div>
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Fuel usage (PNG / CNG / diesel)</h2>
        <Field name="fuel" label="From the 07:00 report where available" value={prefill.fuel} rows={2} />
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Water treatment plant</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field name="wtp:raw_running" label="Raw water pump running" value={prefill.wtp.raw_running} />
          <Field name="wtp:treated_running" label="Treated water pump running" value={prefill.wtp.treated_running} />
          <Field name="wtp:standby" label="Standby" value={prefill.wtp.standby} />
          <Field name="wtp:ph" label="pH" value={prefill.wtp.ph} />
          <Field name="wtp:raw_level" label="Water level – raw water" value={prefill.wtp.raw_level} />
          <Field name="wtp:treated_level" label="Water level – treated water" value={prefill.wtp.treated_level} />
        </div>
        <Field name="wtp:faults" label="Maintenance / faults" value={prefill.wtp.faults} rows={2} />
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">Caustic mixing</h2>
        <Field name="caustic" label="Status / quantity mixed" value={prefill.caustic} rows={2} />
      </section>

      <section className="card space-y-3">
        <h2 className="section-title">End-of-shift checklist</h2>
        <p className="text-xs text-gray-500">{openFlags} open flag(s) in your areas will be passed on with this handover.</p>
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
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Submitting…" : "Submit handover and check out"}</button>
    </form>
  );
}
