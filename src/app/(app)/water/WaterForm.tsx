"use client";

import { useActionState, useState } from "react";
import { WATER_LABEL, WATER_STYLE, waterStatus, type WaterLimits, type WaterStatus } from "@/lib/water";
import { saveWater } from "./actions";

export interface WaterTest extends WaterLimits {
  id: string; parameter: string; unit: string | null; frequency: string; frequency_text: string | null;
  spec_text: string | null; alert_text: string | null; method: string | null; media: string | null;
  is_text: boolean; needs_review: boolean;
}
export interface Existing { value_num: number | null; value_text: string | null; status: WaterStatus; comment: string | null }

const FREQ: Record<string, string> = { weekly: "Weekly", fortnightly: "Fortnightly", monthly: "Monthly", quarterly: "Quarterly", annual: "Annual", conditional: "If coliforms present" };

export function WaterForm({ tests, existing, sampledOn, canEnter }: {
  tests: WaterTest[]; existing: Record<string, Existing>; sampledOn: string; canEnter: boolean;
}) {
  const [state, action, pending] = useActionState<{ ok?: string; error?: string }, FormData>(saveWater, {});
  const [vals, setVals] = useState<Record<string, string>>({});
  const open = tests.filter((t) => !existing[t.id]).length;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="sampled_on" value={sampledOn} />
      {tests.map((t) => {
        const ex = existing[t.id];
        const v = vals[t.id];
        const st = !t.is_text && v ? waterStatus(t, Number(v.replace(",", "."))) : null;
        const bad = st === "alert" || st === "action";
        return (
          <div key={t.id} className={`card ${bad ? "border-amber-300" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{t.parameter}</div>
                <div className="text-xs text-gray-500">
                  {FREQ[t.frequency] ?? t.frequency}{t.method ? ` · ${t.method}` : ""}{t.media ? ` · ${t.media}` : ""}
                </div>
              </div>
              <div className="text-right text-xs text-gray-600">
                <div>Spec: {t.spec_text ?? "—"}</div>
                {t.alert_text && <div>Alert: {t.alert_text}</div>}
                {t.needs_review && <div className="text-warn">⚠ limit to be confirmed</div>}
              </div>
            </div>
            {ex ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span><b>{ex.value_num ?? ex.value_text}</b> {t.unit}{ex.comment && <span className="ml-2 text-xs text-gray-500">“{ex.comment}”</span>}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${WATER_STYLE[ex.status]}`}>{WATER_LABEL[ex.status]}</span>
              </div>
            ) : canEnter ? (
              <>
                {t.is_text && <input type="hidden" name={`t:${t.id}`} value="1" />}
                <div className="mt-2 flex items-center gap-2">
                  <input name={`v:${t.id}`} className="input" inputMode={t.is_text ? "text" : "decimal"} autoComplete="off"
                    placeholder={t.unit ?? (t.is_text ? "Observation" : "")} onChange={(e) => setVals((x) => ({ ...x, [t.id]: e.target.value }))} />
                  {st && <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${WATER_STYLE[st]}`}>{WATER_LABEL[st]}</span>}
                </div>
                {bad && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input name={`c:${t.id}`} className="input" placeholder="Comment (required at alert or above)" />
                    <input name={`a:${t.id}`} className="input" placeholder="Action taken (resample, sanitise…)" />
                  </div>
                )}
              </>
            ) : <p className="mt-2 text-sm text-gray-400">Not recorded</p>}
          </div>
        );
      })}
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      {canEnter && open > 0 && (
        <button type="submit" disabled={pending} className="btn-primary sticky bottom-3 w-full shadow-lg">{pending ? "Saving…" : "Save results"}</button>
      )}
    </form>
  );
}
