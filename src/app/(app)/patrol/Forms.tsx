"use client";

import { useActionState, useState } from "react";
import { Logo } from "@/components/Logo";
import { EvidenceUpload } from "@/components/EvidenceUpload";
import { issueLabel, recordVisit, type LabelState, type VisitState } from "./actions";

export function LabelButton({ id, name, area }: { id: string; name: string; area: string }) {
  const [s, action, pending] = useActionState<LabelState, FormData>(issueLabel, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} /><input type="hidden" name="name" value={name} />
      {!s.svg && <button className="btn-secondary btn-sm" disabled={pending}>{pending ? "…" : "Issue code & label"}</button>}
      {s.error && <span className="ml-2 text-xs text-crit">{s.error}</span>}
      {s.svg && (
        <div className="mt-2 flex max-w-md break-inside-avoid items-center gap-4 rounded-xl border-2 border-brand-red bg-white p-4">
          <div className="h-36 w-36 shrink-0" dangerouslySetInnerHTML={{ __html: s.svg }} />
          <div className="space-y-1"><Logo height={20} /><b className="block text-lg">{s.name}</b>
            <span className="block text-sm">Patrol point · {area}</span>
            <span className="block text-xs text-gray-500">Scan on every round to record your check. Print this card (Ctrl+P) and fix it at the point.</span></div>
        </div>
      )}
    </form>
  );
}

/** The form an operator sees after scanning a patrol point's label. */
export function VisitForm({ point, code, name, checks }: { point: string; code: string; name: string; checks: string[] }) {
  const [s, action, pending] = useActionState<VisitState, FormData>(recordVisit, {});
  const [ans, setAns] = useState<Record<number, string>>({});
  const issue = Object.values(ans).includes("issue");
  if (s.visitId) {
    return (
      <div className="card space-y-3 border-green-300">
        <p className="section-title text-ok">✓ Round recorded at {name}</p>
        <p className="text-sm text-gray-600">Add a photo if there is something to show (optional).</p>
        <EvidenceUpload entityType="patrol_visit" entityId={s.visitId} label="Add photo" />
      </div>
    );
  }
  return (
    <form action={action} className="card space-y-3">
      <input type="hidden" name="point" value={point} /><input type="hidden" name="code" value={code} />
      <input type="hidden" name="checks" value={JSON.stringify(checks)} />
      <ul className="divide-y">
        {checks.map((c, i) => (
          <li key={c} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <span className="text-sm">{c}</span>
            <div className="flex gap-1">
              {[["ok", "OK"], ["issue", "Issue"]].map(([v, l]) => (
                <label key={v} className={`tab cursor-pointer ${ans[i] === v ? (v === "issue" ? "border-crit bg-crit text-white" : "tab-on") : ""}`}>
                  <input type="radio" name={`a:${i}`} value={v} required className="sr-only" onChange={() => setAns({ ...ans, [i]: v })} />{l}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <textarea name="note" rows={3} className="input" required={issue} minLength={issue ? 5 : undefined}
        placeholder={issue ? "Describe the issue: what, where, how bad *" : "Note (optional)"} />
      {s.error && <p role="alert" className="text-sm text-crit">{s.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Record this round"}</button>
    </form>
  );
}

/** Utility 1, Utility 2, or another area typed in (patrol points can be outside the utility areas). */
export function AreaPicker({ area, label }: { area?: string | null; label?: string | null }) {
  const [v, setV] = useState(area ?? (label ? "other" : "U1"));
  return (
    <div className="grid gap-2 sm:col-span-2 sm:grid-cols-2">
      <select name="area" value={v} onChange={(e) => setV(e.target.value)} className="input" aria-label="Area">
        <option value="U1">Utility 1</option><option value="U2">Utility 2</option><option value="other">Other area…</option>
      </select>
      {v === "other" && <input name="area_label" required minLength={2} defaultValue={label ?? ""} placeholder="Area name (e.g. Tank farm)" className="input" />}
    </div>
  );
}
