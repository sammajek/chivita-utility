"use client";

import { useActionState } from "react";
import { saveRca, type FormState } from "../downtime/actions";

export interface RcaValues {
  id?: string; downtime_id?: string | null; asset_id?: string; problem?: string;
  why1?: string | null; why2?: string | null; why3?: string | null; why4?: string | null; why5?: string | null;
  root_cause?: string | null; category_6m?: string | null; corrective_action?: string | null; preventive_action?: string | null;
  action_type?: string | null; capex_required?: boolean; capex_amount_ngn?: number | null; cost_ngn?: number | null;
  target_date?: string | null; status?: string; effectiveness_note?: string | null;
}

const T = ({ name, label, v, rows = 2 }: { name: string; label: string; v?: string | null; rows?: number }) => (
  <label className="block"><span className="text-xs font-medium text-gray-600">{label}</span>
    <textarea name={name} rows={rows} className="input" defaultValue={v ?? ""} /></label>
);
const S = ({ name, label, items, v }: { name: string; label: string; items: string[]; v?: string | null }) => (
  <label className="block"><span className="text-xs font-medium text-gray-600">{label}</span>
    <select name={name} className="input" defaultValue={v ?? ""}><option value="">—</option>{items.map((i) => <option key={i}>{i}</option>)}</select></label>
);

export function RcaForm({ r, assets, lists, readOnly }: {
  r: RcaValues; assets: { id: string; code: string; name: string }[]; lists: Record<string, string[]>; readOnly: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveRca, {});
  return (
    <form action={action} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        {r.id && <input type="hidden" name="id" value={r.id} />}
        {r.downtime_id && <input type="hidden" name="downtime_id" value={r.downtime_id} />}
        <div className="card grid gap-3">
          <label className="block"><span className="text-xs font-medium text-gray-600">Equipment *</span>
            <select name="asset_id" className="input" defaultValue={r.asset_id} required>
              <option value="">—</option>{assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select></label>
          <T name="problem" label="Problem statement *" v={r.problem} />
        </div>
        <div className="card grid gap-3">
          <h2 className="font-semibold">5 Whys</h2>
          {[1, 2, 3, 4, 5].map((n) => <T key={n} name={`why${n}`} label={`Why ${n}?`} v={r[`why${n}` as keyof RcaValues] as string} rows={1} />)}
          <T name="root_cause" label="Root cause" v={r.root_cause} />
          <S name="category_6m" label="Root cause category (6M)" items={lists.category_6m ?? []} v={r.category_6m} />
        </div>
        <div className="card grid gap-3 sm:grid-cols-2">
          <T name="corrective_action" label="Corrective action" v={r.corrective_action} />
          <T name="preventive_action" label="Preventive action" v={r.preventive_action} />
          <S name="action_type" label="Action type" items={lists.action_type ?? []} v={r.action_type} />
          <label className="block"><span className="text-xs font-medium text-gray-600">Target date</span>
            <input type="date" name="target_date" className="input" defaultValue={r.target_date ?? ""} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="capex_required" defaultChecked={r.capex_required} className="h-5 w-5" /> CAPEX required</label>
          <label className="block"><span className="text-xs font-medium text-gray-600">CAPEX amount (NGN)</span>
            <input name="capex_amount_ngn" inputMode="decimal" className="input" defaultValue={r.capex_amount_ngn ?? ""} /></label>
          <label className="block"><span className="text-xs font-medium text-gray-600">Cost (NGN)</span>
            <input name="cost_ngn" inputMode="decimal" className="input" defaultValue={r.cost_ngn ?? ""} /></label>
          <S name="status" label="RCA status" items={lists.rca_status ?? []} v={r.status ?? "Not Started"} />
          <div className="sm:col-span-2"><T name="effectiveness_note" label="Effectiveness verification" v={r.effectiveness_note} /></div>
        </div>
      </fieldset>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{state.error}</p>}
      {!readOnly && <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save RCA"}</button>}
    </form>
  );
}
