"use client";

import { useActionState, useState } from "react";
import type { ListItem } from "@/lib/data/lists";
import { saveDowntime, type FormState } from "./actions";

type Asset = { id: string; code: string; name: string; category: { name: string } };

export interface Cause { downtime_type: string; equipment_category: string | null; failure_category: string; failure_mode: string; issue_descriptions: string[] }

const TYPE_HELP: Record<string, string> = {
  "Unplanned Breakdown": "Counts against availability (OEE), MTTR and MTBF. RCA is opened automatically at ≥ 4 h or the 3rd repeat.",
  "Condition-Based Maintenance (CBM)": "Stopped because an inspection or trend showed a problem. Counts as a loss only if the machine had to stop at once; otherwise treated as planned. RCA on the 3rd repeat.",
  "Planned Maintenance": "Not an availability loss: planned time is taken out of scheduled time. Only time beyond the planned duration counts as a loss. No RCA.",
  "External Supply Failure": "Power, gas or water supply from outside. Shown separately and not charged to the machine. No automatic RCA.",
};

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
  immediate_stop?: boolean;
  planned_hours?: string;
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

/** "Attended by": tick every section that worked on it; anyone else goes in "Other". Stored as "A; B; Other: X". */
function AttendedBy({ items, value }: { items: string[]; value?: string }) {
  const parts = (value ?? "").split(";").map((p) => p.trim()).filter(Boolean);
  const other = parts.find((p) => p.startsWith("Other:"))?.slice(6).trim() ?? parts.filter((p) => !items.includes(p) && !p.startsWith("Other:")).join(", ");
  return (
    <fieldset className="block sm:col-span-2">
      <legend className="text-xs font-medium text-gray-600">Attended by (tick all that apply)</legend>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {items.map((i) => (
          <label key={i} className="flex min-h-10 items-center gap-2 rounded border px-2 text-sm">
            <input type="checkbox" name="attended_by" value={i} defaultChecked={parts.includes(i)} className="h-5 w-5" /> {i}
          </label>
        ))}
      </div>
      <input name="attended_by_other" className="input mt-2" placeholder="Other section / company (optional)" defaultValue={other} />
    </fieldset>
  );
}

export function DowntimeForm({ lists, assets, d, canClose, causes, generalIssues }: {
  lists: Record<string, ListItem[]>; assets: Asset[]; d: DowntimeDefaults; canClose: boolean; causes: Cause[]; generalIssues: string[];
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveDowntime, {});
  const [assetId, setAssetId] = useState(d.asset_id ?? "");
  const [type, setType] = useState(d.downtime_type ?? "");
  const [cat, setCat] = useState(d.failure_category ?? "");
  const [mode, setMode] = useState(d.failure_mode ?? "");
  const [urgent, setUrgent] = useState(d.immediate_stop ?? false);
  const [override, setOverride] = useState(d.override_hours ?? "");
  const v = (n: string) => (lists[n] ?? []).map((i) => i.value);
  const equipCat = assets.find((a) => a.id === assetId)?.category.name ?? "";
  // machine-specific causes first, then the ones that apply to every machine
  const fits = causes.filter((c) => c.downtime_type === type && (c.equipment_category === null || c.equipment_category === equipCat))
    .sort((a, b) => Number(a.equipment_category === null) - Number(b.equipment_category === null));
  const keep = (list: string[], cur: string) => (cur && !list.includes(cur) ? [...list, cur] : list); // older events keep their values
  const cats = keep([...new Set(fits.map((c) => c.failure_category))], d.downtime_type === type ? d.failure_category ?? "" : "");
  const modes = keep([...new Set(fits.filter((c) => c.failure_category === cat).map((c) => c.failure_mode))],
    d.failure_category === cat ? d.failure_mode ?? "" : "");
  const issues = [...new Set([...fits.filter((c) => c.failure_category === cat && c.failure_mode === mode).flatMap((c) => c.issue_descriptions), ...generalIssues])];
  const types = keep(v("downtime_type"), d.downtime_type ?? "");
  const showPlanned = type === "Planned Maintenance" || (type === "Condition-Based Maintenance (CBM)" && !urgent);
  const statuses = v("downtime_status").filter((s) => canClose || s !== "Closed" || d.status === "Closed");

  const byCat = assets.reduce<Record<string, Asset[]>>((acc, a) => ((acc[a.category.name] ??= []).push(a), acc), {});

  return (
    <form action={action} className="space-y-4">
      {d.id && <input type="hidden" name="id" value={d.id} />}
      <div className="card grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-gray-600">Equipment *</span>
          <select name="asset_id" className="input" value={assetId} onChange={(e) => { setAssetId(e.target.value); setCat(""); setMode(""); }} required>
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
        <p className="text-xs text-gray-500 sm:col-span-2">Pick the equipment first: each step then shows only the causes that fit that machine and the step before.</p>
        <div className="sm:col-span-2">
          <Select name="downtime_type" label="1. Downtime type" items={types} value={type} onChange={(x) => { setType(x); setCat(""); setMode(""); }} required />
          {type && TYPE_HELP[type] && <p className="mt-1 text-xs text-gray-600">{TYPE_HELP[type]}</p>}
        </div>
        {type === "Condition-Based Maintenance (CBM)" && (
          <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="immediate_stop" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-5 w-5" />
            The machine had to stop at once (could not wait for a planned slot)
          </label>
        )}
        {showPlanned && (
          <label className="block sm:col-span-2"><span className="text-xs font-medium text-gray-600">Planned duration (hours) — time beyond it counts as a loss</span>
            <input name="planned_hours" inputMode="decimal" className="input" defaultValue={d.planned_hours} placeholder="e.g. 6" /></label>
        )}
        <Select name="failure_category" label="2. Failure category" items={cats} value={cat} onChange={(x) => { setCat(x); setMode(""); }} required />
        <Select name="failure_mode" label="3. Failure mode" items={modes} value={mode} onChange={setMode} required />
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-gray-600">4. Issue description (pick or type what was seen)</span>
          <input name="issue_description" list="issue-options" className="input" defaultValue={d.issue_description} autoComplete="off" />
          <datalist id="issue-options">{issues.map((i) => <option key={i} value={i} />)}</datalist>
        </label>
        {!assetId && <p className="text-xs text-warn sm:col-span-2">Choose the equipment to see its causes.</p>}
      </div>

      <div className="card grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="text-xs font-medium text-gray-600">Immediate action taken</span>
          <textarea name="immediate_action" rows={2} className="input" defaultValue={d.immediate_action} /></label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Spares / materials used</span>
          <input name="spares_used" className="input" defaultValue={d.spares_used} /></label>
        <AttendedBy items={v("attended_by")} value={d.attended_by} />
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
