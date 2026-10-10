"use client";

import { useActionState, useState } from "react";
import { acknowledgeFlag, resolveFlag, type ActionState } from "../duty/actions";

export function FlagActions({ id, acknowledged, canResolve }: { id: string; acknowledged: boolean; canResolve: boolean }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<ActionState, FormData>(resolveFlag, {});
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {!acknowledged && (
        <button type="button" onClick={() => acknowledgeFlag(id)} className="rounded border px-3 py-1.5 text-sm">Acknowledge</button>
      )}
      {canResolve && !open && (
        <button type="button" onClick={() => setOpen(true)} className="rounded border px-3 py-1.5 text-sm">Close…</button>
      )}
      {open && (
        <form action={action} className="flex w-full gap-2">
          <input type="hidden" name="id" value={id} />
          <input name="note" className="input py-2" placeholder="How was it resolved?" required minLength={3} />
          <button className="btn-primary min-h-10 px-3 text-sm" disabled={pending}>Close flag</button>
        </form>
      )}
      {state.error && <span className="text-sm text-crit">{state.error}</span>}
    </div>
  );
}
