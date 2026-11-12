"use client";

import { useActionState, useState } from "react";
import { RESULT_LABEL, type PmResult, pmName } from "@/lib/pm";
import type { PmCompletion, PmTask } from "@/lib/data/pm";
import { DemoBadge } from "@/components/StatusBadge";
import { EvidenceUpload } from "@/components/EvidenceUpload";

const LONG = ["monthly", "quarterly", "bi_annual", "annual"];
import { savePm, type PmSaveState } from "./actions";

const RESULT_STYLE: Record<PmResult, string> = {
  done_ok: "border-green-600 bg-green-50 text-ok",
  done_not_ok: "border-crit bg-red-50 text-crit",
  pending: "border-amber-500 bg-amber-50 text-warn",
  not_done: "border-gray-500 bg-gray-100 text-gray-700",
};
const ORDER: PmResult[] = ["done_ok", "done_not_ok", "pending", "not_done"];
const NOTE_HINT: Partial<Record<PmResult, string>> = {
  done_not_ok: "What issue was found / action raised (required)",
  not_done: "Why was it skipped? (required)",
  pending: "Why is it pending? (optional)",
};

/** The four result buttons, the note and (for Pending) the date it will be done by. */
function ResultPicker({ taskId, sel, onPick, allowPending, minDate }: { taskId: string; sel?: PmResult; onPick: (r: PmResult) => void; allowPending: boolean; minDate: string }) {
  const choices = ORDER.filter((r) => allowPending || r !== "pending");
  return (
    <>
      <div className={`mt-2 grid gap-2 ${choices.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        {choices.map((r) => (
          <label key={r} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-2 px-2 text-center text-sm font-semibold leading-tight ${sel === r ? RESULT_STYLE[r] : "border-gray-200 bg-white text-gray-700"}`}>
            <input type="radio" name={`r:${taskId}`} value={r} className="sr-only" onChange={() => onPick(r)} />
            <span className="mr-1 text-base">{RESULT_LABEL[r].code}</span> {RESULT_LABEL[r].text}
          </label>
        ))}
      </div>
      {sel === "pending" && (
        <label className="mt-2 block text-sm"><span className="text-xs font-medium text-gray-600">Will be done by *</span>
          <input type="date" name={`d:${taskId}`} required min={minDate} className="input" /></label>
      )}
      {sel && sel !== "done_ok" && (
        <input name={`n:${taskId}`} required={sel !== "pending"} className="input mt-2" placeholder={NOTE_HINT[sel]} />
      )}
    </>
  );
}

export function PmForm({ tasks, existing, names, periodStart, canEnter, photos }: {
  tasks: PmTask[];
  existing: Record<string, PmCompletion>;
  photos: string[];
  names: Record<string, string>;
  periodStart: string;
  canEnter: boolean;
}) {
  const [state, action, pending] = useActionState<PmSaveState, FormData>(savePm, {});
  const [picked, setPicked] = useState<Record<string, PmResult>>({});
  const open = tasks.filter((t) => !existing[t.id] || existing[t.id].result === "pending");
  const nPicked = Object.keys(picked).length;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="period_start" value={periodStart} />
      {tasks.map((t) => {
        const ex = existing[t.id];
        const sel = picked[t.id];
        return (
          <div key={t.id} className={`card ${sel === "done_not_ok" ? "border-red-300" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="font-semibold">
                <span className="mr-1 text-xs text-gray-400">#{t.register_sn}</span>
                {pmName(t.equipment_as_written)}
                {t.asset ? (
                  <span className="ml-1 text-xs font-normal text-gray-500">({t.asset.code})</span>
                ) : (
                  <span className="ml-1 text-xs font-normal text-warn">(equipment not mapped yet)</span>
                )}
              </div>
              {LONG.includes(t.frequency) && t.asset && !ex && canEnter && (
                <span className="text-xs font-semibold text-brand-blue">Scan {t.asset.code}’s label at the machine before completing</span>
              )}
              {t.hours_interval && (
                <span className="text-xs text-gray-500">Running-hours service: every {t.hours_interval.toLocaleString()} h</span>
              )}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
              {t.tasks.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
            {ex && ex.result === "pending" ? (
              <div className="mt-2 space-y-1">
                <p className="text-sm"><span className={`rounded border px-2 py-0.5 font-semibold ${RESULT_STYLE.pending}`}>P Pending</span>{" "}
                  <span className="text-xs text-gray-600">to be done by <b>{ex.pending_until}</b> · by {ex.recorded_by_id ? names[ex.recorded_by_id] ?? "—" : "—"}{ex.note ? ` · “${ex.note}”` : ""}</span></p>
                {canEnter && (<>
                  <input type="hidden" name={`p:${t.id}`} value={ex.id} />
                  <p className="text-xs text-gray-500">Record the final result when it is done:</p>
                  <ResultPicker taskId={t.id} sel={sel} onPick={(r) => setPicked((p) => ({ ...p, [t.id]: r }))} allowPending={false} minDate={periodStart} />
                </>)}
              </div>
            ) : ex ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded border px-2 py-0.5 font-semibold ${RESULT_STYLE[ex.result]}`}>
                  {RESULT_LABEL[ex.result].code} {RESULT_LABEL[ex.result].text}
                </span>
                <span className="text-xs text-gray-500">by {ex.recorded_by_id ? names[ex.recorded_by_id] ?? "—" : "—"}</span>
                {ex.is_demo && <DemoBadge />}
                {ex.site_verified && <span className="rounded bg-blue-50 px-1.5 text-xs font-semibold text-brand-blue">✓ verified at machine</span>}
                {ex.note && <span className="text-xs text-gray-600">“{ex.note}”</span>}
                {canEnter && t.asset?.criticality === "A" && LONG.includes(t.frequency) && ["done_ok", "done_not_ok"].includes(ex.result) && !photos.includes(ex.id) && (
                  <div className="w-full rounded-lg bg-amber-50 p-2">
                    <p className="mb-1 text-xs font-semibold text-warn">Critical equipment: attach a photo of the work (required)</p>
                    <EvidenceUpload entityType="pm_completion" entityId={ex.id} label="Add photo" />
                  </div>
                )}
              </div>
            ) : canEnter ? (
              <ResultPicker taskId={t.id} sel={sel} onPick={(r) => setPicked((p) => ({ ...p, [t.id]: r }))} allowPending minDate={periodStart} />
            ) : (
              <p className="mt-2 text-sm text-gray-400">Not recorded</p>
            )}
          </div>
        );
      })}

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">Saved {state.saved} PM result(s).</p>}
      {canEnter && open.length > 0 && (
        <button type="submit" disabled={pending || nPicked === 0} className="btn-primary sticky bottom-3 w-full shadow-lg">
          {pending ? "Saving…" : nPicked ? `Save ${nPicked} PM result${nPicked > 1 ? "s" : ""}` : "Tick a result to save"}
        </button>
      )}
    </form>
  );
}
