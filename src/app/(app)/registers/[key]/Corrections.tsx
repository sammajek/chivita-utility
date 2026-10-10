import { ActionForm } from "@/components/ActionForm";
import type { Field, Reading } from "@/lib/types";
import { correctReading } from "./actions";

/** Correct or void saved values. Each change needs a reason and is kept in the audit log. */
export function Corrections({ fields, existing, path, userId, isEngineer }: {
  fields: Field[];
  existing: Record<string, Reading>;
  path: string;
  userId: string;
  isEngineer: boolean;
}) {
  const editable = fields.filter((f) => {
    const r = existing[f.id];
    return r && (isEngineer || r.recorded_by_id === userId);
  });
  if (editable.length === 0) return null;
  return (
    <details className="card">
      <summary className="cursor-pointer font-medium">Correct or void a saved value</summary>
      <p className="mt-1 text-xs text-gray-500">
        The old value, who changed it, when and why are kept in the audit log. You can change values you entered;
        engineers and managers can change any.
      </p>
      <div className="mt-3 space-y-4">
        {editable.map((f) => {
          const r = existing[f.id];
          const pr = f.parameter;
          const isNum = pr.data_type === "number";
          return (
            <ActionForm key={f.id} action={correctReading} submit="Apply" className="space-y-2 border-t pt-3">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="numeric" value={isNum ? "1" : "0"} />
              <input type="hidden" name="path" value={path} />
              <p className="text-sm">
                <b>{f.label}</b>: saved <b>{r.value_num ?? r.value_text}</b> {pr.unit}
              </p>
              <div className="grid gap-2 sm:grid-cols-4">
                <select name="mode" className="input" defaultValue="amend">
                  <option value="amend">Correct value</option>
                  <option value="void">Void (remove)</option>
                </select>
                {isNum || !pr.options ? (
                  <input name="value" className="input" inputMode={isNum ? "decimal" : "text"} placeholder="New value" autoComplete="off" />
                ) : (
                  <select name="value" className="input" defaultValue={r.value_text ?? ""}>
                    {pr.options.map((o) => <option key={o}>{o}</option>)}
                  </select>
                )}
                <input name="comment" className="input" placeholder="Comment (if out of spec)" />
                <input name="reason" className="input" placeholder="Reason for change (required)" required minLength={5} />
              </div>
            </ActionForm>
          );
        })}
      </div>
    </details>
  );
}
