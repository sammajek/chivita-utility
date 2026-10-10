"use client";

import { useActionState, useMemo, useState } from "react";
import { describeStandard, evaluateValue, type ReadingStatus } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import type { Field, Reading } from "@/lib/types";
import { saveReadings, type SaveState } from "./actions";

interface Props {
  registerKey: string;
  assetId: string | null;
  logDate: string;
  slotKey: string;
  readingFor: string;
  fields: Field[];
  fieldAssetCodes: Record<string, string>;
  existing: Record<string, Reading>;
  canEnter: boolean;
}

export function EntryForm(p: Props) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveReadings, {});
  const [values, setValues] = useState<Record<string, string>>({});

  const statusOf = useMemo(
    () => (f: Field): ReadingStatus | null => {
      const v = values[f.id];
      if (v === undefined || v === "") return null;
      const pr = f.parameter;
      return pr.data_type === "number" ? evaluateValue(pr, Number(v.replace(",", ".")), null) : evaluateValue(pr, null, v);
    },
    [values],
  );

  const pending_ = p.fields.filter((f) => !p.existing[f.id]);
  const fieldAssets = Object.fromEntries(p.fields.filter((f) => f.asset_id).map((f) => [f.id, f.asset_id as string]));
  const numeric = p.fields.filter((f) => f.parameter.data_type === "number").map((f) => f.id);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="register_key" value={p.registerKey} />
      <input type="hidden" name="asset_id" value={p.assetId ?? ""} />
      <input type="hidden" name="log_date" value={p.logDate} />
      <input type="hidden" name="slot_key" value={p.slotKey} />
      <input type="hidden" name="reading_for" value={p.readingFor} />
      <input type="hidden" name="field_assets" value={JSON.stringify(fieldAssets)} />
      <input type="hidden" name="numeric_fields" value={JSON.stringify(numeric)} />

      {p.fields.map((f) => {
        const ex = p.existing[f.id];
        const st = statusOf(f);
        const pr = f.parameter;
        const bad = st === "out_of_spec" || st === "critical";
        return (
          <div key={f.id} className={`card ${bad ? "border-amber-300" : ""}`}>
            <div className="flex items-start justify-between gap-2">
              <label htmlFor={`v-${f.id}`} className="font-medium">
                {f.label}
                {f.asset_id && p.fieldAssetCodes[f.id] && (
                  <span className="ml-1 text-xs text-gray-500">({p.fieldAssetCodes[f.id]})</span>
                )}
              </label>
              <span className="shrink-0 text-xs text-gray-500">
                Std: {describeStandard(pr, pr.unit)}
                {pr.needs_review && <span className="ml-1 text-warn" title={pr.review_note ?? ""}>⚠ review</span>}
              </span>
            </div>
            {ex ? (
              <div className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span>
                  <b>{ex.value_num ?? ex.value_text}</b> {pr.unit}
                  {ex.amended && <span className="ml-1 text-xs text-gray-500">(amended)</span>}
                  {ex.comment && <span className="ml-2 text-xs text-gray-500">“{ex.comment}”</span>}
                </span>
                <StatusBadge status={ex.status} />
              </div>
            ) : !p.canEnter ? (
              <p className="mt-2 text-sm text-gray-400">Not entered</p>
            ) : pr.data_type === "select" && pr.options ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {pr.options.map((o) => (
                  <label key={o} className={`btn-secondary cursor-pointer ${values[f.id] === o ? "border-brand-blue bg-blue-50" : ""}`}>
                    <input type="radio" name={`v:${f.id}`} value={o} className="sr-only"
                      onChange={() => setValues((v) => ({ ...v, [f.id]: o }))} />
                    {o}
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <input id={`v-${f.id}`} name={`v:${f.id}`} className="input" inputMode="decimal" autoComplete="off"
                  placeholder={pr.unit ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />
                {st && <StatusBadge status={st} />}
              </div>
            )}
            {!ex && bad && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <input name={`c:${f.id}`} className="input" placeholder="Comment (required if out of spec)" />
                <input name={`a:${f.id}`} className="input" placeholder="Action taken" />
              </div>
            )}
          </div>
        );
      })}

      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">Saved {state.saved} value(s).</p>}
      {p.canEnter && pending_.length > 0 && (
        <button type="submit" disabled={pending} className="btn-primary sticky bottom-3 w-full shadow-lg">
          {pending ? "Saving…" : `Save ${pending_.length > 1 ? "readings" : "reading"}`}
        </button>
      )}
    </form>
  );
}
