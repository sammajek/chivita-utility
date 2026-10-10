"use client";

import { useActionState, useState } from "react";
import { saveCleaning } from "./actions";

export interface Zone { id: number; day_of_week: number; area: string; name: string }
export interface Activity { id: number; sort: number; name: string }
export interface Check { id: string; zone_id: number; activity_id: number; result: "done" | "not_done"; note: string | null; recorded_by_id: string | null; is_demo: boolean }

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function CleaningForm({ zones, activities, checks, names, weekStart, canEnter }: {
  zones: Zone[]; activities: Activity[]; checks: Check[]; names: Record<string, string>; weekStart: string; canEnter: boolean;
}) {
  const [state, action, pending] = useActionState<{ ok?: string; error?: string }, FormData>(saveCleaning, {});
  const [picked, setPicked] = useState<Record<string, string>>({});
  const byKey = new Map(checks.map((c) => [`${c.zone_id}:${c.activity_id}`, c]));
  const open = zones.length * activities.length - checks.length;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="week_start" value={weekStart} />
      {zones.map((z) => (
        <div key={z.id} className="card">
          <div className="font-semibold">{DAYS[z.day_of_week]} <span className="text-xs font-normal text-gray-500">· {z.area === "U1" ? "Utility 1" : "Utility 2"}</span></div>
          <div className="text-sm text-gray-600">{z.name}</div>
          <div className="mt-2 space-y-2">
            {activities.map((a) => {
              const key = `${z.id}:${a.id}`;
              const ex = byKey.get(key);
              return (
                <div key={a.id} className="rounded-lg border border-gray-100 p-2">
                  <div className="text-sm">{a.name}</div>
                  {ex ? (
                    <div className="mt-1 text-xs">
                      <span className={`rounded px-2 py-0.5 font-semibold ${ex.result === "done" ? "bg-green-100 text-ok" : "bg-amber-100 text-warn"}`}>
                        {ex.result === "done" ? "✓ Done" : "Not done"}
                      </span>
                      <span className="ml-2 text-gray-500">{ex.recorded_by_id ? names[ex.recorded_by_id] : ""}</span>
                      {ex.is_demo && <span className="ml-1 text-purple-700">DEMO</span>}
                      {ex.note && <span className="ml-2 text-gray-600">“{ex.note}”</span>}
                    </div>
                  ) : canEnter ? (
                    <>
                      <div className="mt-1 grid grid-cols-2 gap-2">
                        {(["done", "not_done"] as const).map((r) => (
                          <label key={r} className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg border-2 text-sm font-semibold ${picked[key] === r ? (r === "done" ? "border-green-600 bg-green-50 text-ok" : "border-warn bg-amber-50 text-warn") : "border-gray-200"}`}>
                            <input type="radio" name={`c:${key}`} value={r} className="sr-only" onChange={() => setPicked((p) => ({ ...p, [key]: r }))} />
                            {r === "done" ? "✓ Done" : "Not done"}
                          </label>
                        ))}
                      </div>
                      {picked[key] === "not_done" && <input name={`n:${key}`} required className="input mt-2" placeholder="Reason (required)" />}
                    </>
                  ) : <div className="mt-1 text-xs text-gray-400">Not recorded</div>}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      {canEnter && open > 0 && (
        <button type="submit" disabled={pending || !Object.keys(picked).length} className="btn-primary sticky bottom-3 w-full shadow-lg">
          {pending ? "Saving…" : Object.keys(picked).length ? `Save ${Object.keys(picked).length}` : "Tick an activity to save"}
        </button>
      )}
    </form>
  );
}
