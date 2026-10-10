"use client";

import { useActionState, useState } from "react";
import type { ListItem } from "@/lib/data/lists";
import { saveDowntime, type FormState } from "./actions";

type Asset = { id: string; code: string; name: string; category: { name: string } };

export interface DowntimeDefaults {
  id?: string;
  asset_id?: string;
  date?: string;
  shift?: string;
  start_time?: string;
  end_time?: string;
  end_date?: string;
  downtime_type?: string;
  failure_category?: string;
  failure_mode?: string;
  issue_description?: string;
  override_hours?: string;
  override_reason?: string;
  immediate_action?: string;
  spares_used?: string;
  attended_by?: string;
  production_impact?: string;
  status?: string;
  remarks?: string;
}

function Select({ name, label, items, value, onChange, required }: {
  name: string; label: string; items: string[]; value?: string; onChange?: (v: string) => void; required?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}{required && " *"}</span>
      <select name={name} className="input" defaultValue={onChange ? undefined : value} value={onChange ? value : undefined}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined} required={required}>
        <option value="">—</option>
        {items.map((i) => <option key={i} value={i}>{i}</option>)}
      </select>
    </label>
  );
}

export function DowntimeForm({ lists, assets, d, canClose }: {
  lists: Record<string, ListItem[]>; assets: Asset[]; d: DowntimeDefaults; canClose: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDowntime, {});
  const [cat, setCat] = useState(d.failure_category ?? "");
  const [override, setOverride] = useState(d.override_hours ?? "");
  const v = (n: string) => (lists[n] ?? []).map((i) => i.value);
  const modes = (lists.failure_mode ?? []).filter((m) => m.parent === cat).map((m) => m.value);
  const statuses = v("downtime_status").filter((s) => canClose || s !== "Closed" || d.status === "Closed");

  const byCat = assets.reduce<Record<string, Asset[]>>((acc, a) => ((acc[a.category.name] ??= []).push(a), acc), {});

  return (
    <form action={action} className="space-y-4">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <div className="card grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-gray-600">Equipment *</span>
          <select name="asset_id" className="input" defaultValue={d.asset_id} required>
            <option value="">—</option>
            {Object.entries(byCat).map(([c, list]) => (
              <optgroup key={c} label={c}>{list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</optgroup>
            ))}
          </select>
        </label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Date *</span>
          <input type="date" name="date" className="input" defaultValue={d.date} required /></label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Shift *</span>
          <select name="shift" className="input" defaultValue={d.shift} required>
            <option value="day">Day Shift (7am - 7pm)</option><option value="night">Night Shift (7pm - 7am)</option>
          </select></label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Start time *</span>
          <input type="time" name="start_time" className="input" defaultValue={d.start_time} required /></label>
        <label className="block"><span className="text-xs font-medium text-gray-600">End time (blank if still down)</span>
          <input type="time" name="end_time" className="input" defaultValue={d.end_time} /></label>
        <label className="block sm:col-span-2"><span className="text-xs font-medium text-gray-600">End date (only if past the next morning)</span>
          <input type="date" name="end_date" className="input" defaultValue={d.end_date} /></label>
        <p className="text-xs text-gray-500 sm:col-span-2">A night shift running past midnight is handled automatically, as in the Excel template.</p>
      </div>

      <div className="card grid gap-3 sm:grid-cols-2">
        <Select name="downtime_type" label="Downtime type" items={v("downtime_type")} value={d.downtime_type} required />
        <Select name="failure_category" label="Failure category" items={v("failure_category")} value={cat} onChange={setCat} required />
        <Select name="failure_mode" label="Issue / failure mode" items={modes} value={d.failure_mode} required />
        <Select name="issue_description" label="Issue description" items={v("issue_description")} value={d.issue_description} />
      </div>

      <div className="card grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="text-xs font-medium text-gray-600">Immediate action taken</span>
          <textarea name="immediate_action" rows={2} className="input" defaultValue={d.immediate_action} /></label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Spares / materials used</span>
          <input name="spares_used" className="input" defaultValue={d.spares_used} /></label>
        <Select name="attended_by" label="Attended by" items={v("attended_by")} value={d.attended_by} />
        <Select name="production_impact" label="Impact on production" items={v("production_impact")} value={d.production_impact} />
        <Select name="status" label="Status" items={statuses} value={d.status ?? "Open"} required />
        <label className="block"><span className="text-xs font-medium text-gray-600">Override hours (optional)</span>
          <input name="override_hours" inputMode="decimal" className="input" value={override} onChange={(e) => setOverride(e.target.value)} /></label>
        {override && (
          <label className="block"><span className="text-xs font-medium text-gray-600">Reason for override *</span>
            <input name="override_reason" className="input" defaultValue={d.override_reason} required /></label>
        )}
        <label className="block sm:col-span-2"><span className="text-xs font-medium text-gray-600">Remarks</span>
          <textarea name="remarks" rows={2} className="input" defaultValue={d.remarks} /></label>
      </div>
      {!canClose && <p className="text-xs text-gray-500">Only engineers and managers can close an event.</p>}
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save downtime event"}</button>
    </form>
  );
}
