"use client";

import { useActionState, useState } from "react";
import { saveMeterReadings, type MeterSaveState } from "./actions";

export interface MeterRow {
  id: string; code: string; name: string; unit: string | null; kind: "totaliser" | "hours" | "rate";
  prev: { date: string; value: number } | null;
  today: { value: number; used: number | null; is_reset: boolean; comment: string | null } | null;
}

const fmt = (n: number) => n.toLocaleString("en-GB", { maximumFractionDigits: 2 });

async function saveOrKeep(prev: MeterSaveState, f: FormData): Promise<MeterSaveState> {
  try {
    return await saveMeterReadings(prev, f);
  } catch {
    return { error: "No connection. Your values are still in the form: press Save again when the network is back." };
  }
}

/** 7 am readings for one sheet of the consumption report: previous reading and today's use shown as you type. */
export function MeterForm({ date, meters, canEnter }: { date: string; meters: MeterRow[]; canEnter: boolean }) {
  const [state, action, pending] = useActionState(saveOrKeep, {});
  const [vals, setVals] = useState<Record<string, string>>({});
  const [resets, setResets] = useState<Record<string, boolean>>({});
  const open = meters.filter((m) => !m.today);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="read_date" value={date} />
      {meters.map((m) => {
        const raw = vals[m.id]?.replace(/,/g, "");
        const v = raw ? Number(raw) : null;
        const used = m.kind === "rate" || v === null || Number.isNaN(v) ? null : resets[m.id] ? v : m.prev ? v - m.prev.value : null;
        const low = used !== null && used < 0;
        return (
          <div key={m.id} className={`card ${low ? "border-red-300" : ""}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={`m-${m.id}`} className="font-medium">{m.name}</label>
              <span className="text-xs text-gray-500">
                {m.kind === "rate" ? "recorded as read" : m.prev ? `previous ${fmt(m.prev.value)} ${m.unit ?? ""} (${m.prev.date})` : "first reading"}
              </span>
            </div>
            {m.today ? (
              <p className="mt-1 text-sm"><b>{fmt(m.today.value)}</b> {m.unit}
                {m.today.used !== null && <span className="ml-2 text-gray-600">used {fmt(m.today.used)} {m.unit}</span>}
                {m.today.is_reset && <span className="ml-2 text-xs text-warn">(reset)</span>}
                {m.today.comment && <span className="ml-2 text-xs text-gray-500">“{m.today.comment}”</span>}</p>
            ) : !canEnter ? (
              <p className="mt-1 text-sm text-gray-400">Not entered</p>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input id={`m-${m.id}`} name={`v:${m.id}`} inputMode="decimal" autoComplete="off" className="input"
                    placeholder={m.unit ?? ""} value={vals[m.id] ?? ""} onChange={(e) => setVals({ ...vals, [m.id]: e.target.value })} />
                  {used !== null && <span className={`shrink-0 text-sm ${low ? "text-crit" : "text-gray-700"}`}>{low ? "lower than previous" : `= ${fmt(used)} ${m.unit ?? ""}`}</span>}
                </div>
                {m.kind !== "rate" && (low || resets[m.id]) && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name={`r:${m.id}`} checked={!!resets[m.id]} onChange={(e) => setResets({ ...resets, [m.id]: e.target.checked })} className="h-5 w-5" />
                    Meter was reset or replaced
                  </label>
                )}
                {v !== null && (
                  <input name={`c:${m.id}`} className="input" placeholder={low || resets[m.id] ? "Comment (required for a reset)" : "Comment (optional)"} />
                )}
              </div>
            )}
          </div>
        );
      })}
      {canEnter && open.length > 0 && (
        <label className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm">
          <input type="checkbox" name="from_paper" value="1" className="h-5 w-5" /> Entered from a paper sheet (outage)
        </label>
      )}
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      {canEnter && open.length > 0 && (
        <button className="btn-primary sticky bottom-3 w-full shadow-lg" disabled={pending}>{pending ? "Saving…" : "Save readings"}</button>
      )}
    </form>
  );
}
