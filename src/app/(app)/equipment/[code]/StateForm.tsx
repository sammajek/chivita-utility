"use client";

import { useActionState, useState } from "react";
import { setState } from "../actions";

const REASONS: Record<string, string[]> = {
  standby: ["Low demand", "Other"],
  unavailable: ["Breakdown", "PM", "CBM", "External supply", "Awaiting spares", "Awaiting vendor", "Other"],
};
const REASON_HINT: Record<string, string> = {
  PM: "Preventive maintenance", CBM: "Condition-based maintenance (e.g. vibration, oil analysis finding)",
  "External supply": "Power, gas, water or other supply failure",
};

/** Toggle: Available / Standby / Unavailable, branching to the reason (PM, breakdown, CBM, …). */
export function StateForm({ assetId, code, current }: { assetId: string; code: string; current: string }) {
  const [state, action, pending] = useActionState(setState, {});
  const [pick, setPick] = useState(current);
  const [reason, setReason] = useState("");
  const btn = (v: string, l: string, on: string) => (
    <button type="button" onClick={() => { setPick(v); setReason(""); }}
      className={`min-h-12 flex-1 rounded-lg border-2 px-3 text-sm font-semibold ${pick === v ? on : "border-gray-200 bg-white text-gray-700"}`}>{l}</button>
  );
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="asset_id" value={assetId} /><input type="hidden" name="code" value={code} />
      <input type="hidden" name="state" value={pick} />
      <div className="flex gap-2">
        {btn("available", "Available", "border-ok bg-green-50 text-ok")}
        {btn("standby", "Standby", "border-brand-blue bg-blue-50 text-brand-blue")}
        {btn("unavailable", "Unavailable", "border-crit bg-red-50 text-crit")}
      </div>
      {pick !== "available" && (
        <div className="grid gap-2 sm:grid-cols-2">
          {REASONS[pick].map((r) => (
            <label key={r} className={`flex min-h-11 items-center gap-2 rounded border px-3 text-sm ${reason === r ? "border-brand-blue bg-blue-50" : ""}`}>
              <input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="h-5 w-5" required={pick === "unavailable"} />
              <span>{r}{REASON_HINT[r] && <span className="block text-xs text-gray-500">{REASON_HINT[r]}</span>}</span>
            </label>
          ))}
        </div>
      )}
      <input name="note" className="input" placeholder={reason === "Other" ? "Describe the reason *" : "Note (optional)"} required={reason === "Other"} />
      {pick === "unavailable" && reason === "Breakdown" && (
        <p className="text-xs text-gray-600">For a breakdown, also <a href="/downtime/new" className="text-brand-blue">log the downtime event</a>: that keeps MTTR/MTBF and RCA correct. Logging downtime sets the state automatically.</p>
      )}
      {state.error && <p role="alert" className="text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      <button className="btn-primary w-full" disabled={pending || pick === current && pick === "available"}>{pending ? "Saving…" : "Update state"}</button>
    </form>
  );
}
