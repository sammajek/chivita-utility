"use client";

import { useActionState, type ReactNode } from "react";

type State = { ok?: string; error?: string };

/** A form bound to a server action, showing its success or error message inline. */
export function ActionForm({ action, children, className, submit = "Save" }: {
  action: (prev: State, form: FormData) => Promise<State>;
  children: ReactNode;
  className?: string;
  submit?: string;
}) {
  const [state, formAction, pending] = useActionState<State, FormData>(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <div className="flex items-center gap-3">
        <button className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={pending}>
          {pending ? "…" : submit}
        </button>
        {state.ok && <span className="text-xs text-ok">{state.ok}</span>}
        {state.error && <span className="text-xs text-crit">{state.error}</span>}
      </div>
    </form>
  );
}
