"use client";

import { useActionState, useState } from "react";
import { RESULT_LABEL, type PmResult } from "@/lib/pm";
import type { PmCompletion, PmTask } from "@/lib/data/pm";
import { DemoBadge } from "@/components/StatusBadge";
import { savePm, type PmSaveState } from "./actions";

const RESULT_STYLE: Record<PmResult, string> = {
  done_ok: "border-green-600 bg-green-50 text-ok",
  not_done: "border-gray-500 bg-gray-100 text-gray-700",
  done_not_ok: "border-crit bg-red-50 text-crit",
};
const ORDER: PmResult[] = ["done_ok", "not_done", "done_not_ok"];

export function PmForm({ tasks, existing, names, periodStart, canEnter }: {
  tasks: PmTask[];
  existing: Record<string, PmCompletion>;
  names: Record<string, string>;
  periodStart: string;
  canEnter: boolean;
}) {
  const [state, action, pending] = useActionState<PmSaveState, FormData>(savePm, {});
  const [picked, setPicked] = useState<Record<string, PmResult>>({});
  const open = tasks.filter((t) => !existing[t.id]);
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
                {t.equipment_as_written.replace(/\.$/, "")}
                {t.asset ? (
                  <span className="ml-1 text-xs font-normal text-gray-500">({t.asset.code})</span>
                ) : (
                  <span className="ml-1 text-xs font-normal text-warn">(equipment not mapped yet)</span>
                )}
              </div>
              {t.hours_interval && (
                <span className="text-xs text-gray-500">Running-hours service: every {t.hours_interval.toLocaleString()} h</span>
              )}
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-gray-700">
              {t.tasks.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
            {ex ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded border px-2 py-0.5 font-semibold ${RESULT_STYLE[ex.result]}`}>
                  {RESULT_LABEL[ex.result].code} {RESULT_LABEL[ex.result].text}
                </span>
                <span className="text-xs text-gray-500">by {ex.recorded_by_id ? names[ex.recorded_by_id] ?? "—" : "—"}</span>
                {ex.is_demo && <DemoBadge />}
                {ex.note && <span className="text-xs text-gray-600">“{ex.note}”</span>}
              </div>
            ) : canEnter ? (
              <>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {ORDER.map((r) => (
                    <label key={r} className={`flex min-h-12 cursor-pointer items-center justify-center rounded-lg border-2 px-2 text-center text-sm font-semibold ${sel === r ? RESULT_STYLE[r] : "border-gray-200 bg-white text-gray-700"}`}>
                      <input type="radio" name={`r:${t.id}`} value={r} className="sr-only"
                        onChange={() => setPicked((p) => ({ ...p, [t.id]: r }))} />
                      <span className="mr-1 text-base">{RESULT_LABEL[r].code}</span> {RESULT_LABEL[r].text}
                    </label>
                  ))}
                </div>
                {sel && sel !== "done_ok" && (
                  <input name={`n:${t.id}`} required className="input mt-2"
                    placeholder={sel === "not_done" ? "Why was it not done? (required)" : "What was wrong / action raised (required)"} />
                )}
              </>
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
