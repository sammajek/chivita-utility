"use client";

import { useActionState, useMemo, useState } from "react";
import { describeStandard, evaluateValue, type ReadingStatus } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { HmiCapture, type CaptureResult } from "@/components/HmiCapture";
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
  userId: string;
}

export function EntryForm(p: Props) {
  const [state, action, pending] = useActionState<SaveState, FormData>(saveReadings, {});
  const [values, setValues] = useState<Record<string, string>>({});
  const [fromPhoto, setFromPhoto] = useState<Record<string, true>>({});
  const [capture, setCapture] = useState<CaptureResult | null>(null);
  const [chip, setChip] = useState<string | null>(null); // leftover number waiting to be placed

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
  const ocrFields = pending_.filter((f) => f.parameter.data_type === "number").map((f) => ({
    id: f.id, label: f.label, unit: f.parameter.unit, std_min: f.parameter.std_min, std_max: f.parameter.std_max,
    crit_min: f.parameter.crit_min, crit_max: f.parameter.crit_max,
  }));

  function setValue(id: string, v: string, photo = false) {
    setValues((x) => ({ ...x, [id]: v }));
    setFromPhoto((x) => {
      const n = { ...x };
      if (photo) n[id] = true;
      else delete n[id];
      return n;
    });
  }

  function onCapture(r: CaptureResult) {
    setCapture(r);
    for (const [id, s] of Object.entries(r.suggestions)) {
      if (!values[id]) setValue(id, s.value, true);
    }
  }

  const filledFromPhoto = Object.keys(fromPhoto).length;

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="register_key" value={p.registerKey} />
      <input type="hidden" name="asset_id" value={p.assetId ?? ""} />
      <input type="hidden" name="log_date" value={p.logDate} />
      <input type="hidden" name="slot_key" value={p.slotKey} />
      <input type="hidden" name="reading_for" value={p.readingFor} />
      <input type="hidden" name="field_assets" value={JSON.stringify(fieldAssets)} />
      <input type="hidden" name="numeric_fields" value={JSON.stringify(numeric)} />
      <input type="hidden" name="photo_path" value={capture?.photoPath ?? ""} />
      <input type="hidden" name="photo_fields" value={JSON.stringify(Object.keys(fromPhoto))} />

      {p.canEnter && ocrFields.length > 0 && (
        <div className="card space-y-2">
          <HmiCapture fields={ocrFields} folder={`${p.userId}/${p.registerKey}/${p.logDate}`} onResult={onCapture} />
          {capture && (
            <div className="flex gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={capture.previewUrl} alt="HMI photo" className="h-24 w-32 shrink-0 rounded border object-cover" />
              <div className="min-w-0 text-xs text-gray-600">
                <p>
                  <b>{Object.keys(capture.suggestions).length}</b> value(s) filled from the photo, highlighted in blue.
                  Check each one against the screen before saving.
                  {!capture.photoPath && " (The photo could not be stored; values are still usable.)"}
                </p>
                {capture.leftovers.length > 0 && (
                  <div className="mt-1">
                    <p>Other numbers on the screen: tap one, then tap the box it belongs to.</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {capture.leftovers.slice(0, 16).map((n, i) => (
                        <button key={i} type="button" onClick={() => setChip(chip === n.value ? null : n.value)} title={n.line}
                          className={`rounded border px-2 py-1 font-mono ${chip === n.value ? "border-brand-blue bg-brand-blue text-white" : "border-gray-300 bg-white"}`}>
                          {n.value}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <details className="mt-1">
                  <summary className="cursor-pointer">Text read from the photo</summary>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-1">{capture.text || "—"}</pre>
                </details>
              </div>
            </div>
          )}
        </div>
      )}

      {p.fields.map((f) => {
        const ex = p.existing[f.id];
        const st = statusOf(f);
        const pr = f.parameter;
        const bad = st === "out_of_spec" || st === "critical";
        const photo = !!fromPhoto[f.id];
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
                    <input type="radio" name={`v:${f.id}`} value={o} className="sr-only" onChange={() => setValue(f.id, o)} />
                    {o}
                  </label>
                ))}
              </div>
            ) : (
              <div className="mt-2">
                <div className="flex items-center gap-2">
                  <input id={`v-${f.id}`} name={`v:${f.id}`} className={`input ${photo ? "border-brand-blue bg-blue-50" : ""}`}
                    inputMode="decimal" autoComplete="off" placeholder={pr.unit ?? ""} value={values[f.id] ?? ""}
                    onChange={(e) => setValue(f.id, e.target.value)}
                    onFocus={() => { if (chip) { setValue(f.id, chip, true); setChip(null); } }} />
                  {st && <StatusBadge status={st} />}
                </div>
                {photo && <p className="mt-1 text-xs text-brand-blue">From photo, check it matches the screen</p>}
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
          {pending ? "Saving…" : filledFromPhoto ? `I have checked the values, save` : `Save ${pending_.length > 1 ? "readings" : "reading"}`}
        </button>
      )}
    </form>
  );
}
