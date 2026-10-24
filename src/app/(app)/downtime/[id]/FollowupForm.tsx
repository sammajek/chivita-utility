"use client";

import { useActionState, useState } from "react";
import { addFollowup } from "../actions";

export const STAGE_LABEL: Record<string, string> = {
  containment: "Containment (temporary fix)",
  further_action: "Further action requested",
  resolved: "Completely resolved",
};

export function FollowupForm({ downtimeId, canResolve, hasEnd }: { downtimeId: string; canResolve: boolean; hasEnd: boolean }) {
  const [state, action, pending] = useActionState(addFollowup, {});
  const [stage, setStage] = useState("containment");
  return (
    <form action={action} className="card space-y-3">
      <h2 className="font-semibold">Add follow-up</h2>
      <input type="hidden" name="downtime_id" value={downtimeId} />
      <div className="grid gap-2 sm:grid-cols-3">
        {Object.entries(STAGE_LABEL).map(([k, l]) => {
          const disabled = k === "resolved" && (!canResolve || !hasEnd);
          return (
            <label key={k} className={`flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm ${stage === k ? "border-brand-blue bg-blue-50" : ""} ${disabled ? "opacity-50" : ""}`}>
              <input type="radio" name="stage" value={k} checked={stage === k} disabled={disabled} onChange={() => setStage(k)} className="h-5 w-5" />
              {l}
            </label>
          );
        })}
      </div>
      {!hasEnd && <p className="text-xs text-gray-500">“Completely resolved” needs the downtime end time first (Update the event).</p>}
      {hasEnd && !canResolve && <p className="text-xs text-gray-500">Only engineers and managers can mark an event completely resolved.</p>}
      <label className="block"><span className="text-xs font-medium text-gray-600">
        {stage === "containment" ? "What was done to contain it? *" : stage === "further_action" ? "What further action is needed? *" : "How was it resolved / verified? *"}
      </span>
        <textarea name="note" rows={2} className="input" required minLength={3} /></label>
      {stage === "further_action" && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block"><span className="text-xs font-medium text-gray-600">Who will do it (person / section / vendor) *</span>
            <input name="action_owner" className="input" required /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Target date *</span>
            <input type="date" name="target_date" className="input" required /></label>
        </div>
      )}
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save follow-up"}</button>
    </form>
  );
}
