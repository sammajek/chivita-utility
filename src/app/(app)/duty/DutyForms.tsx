"use client";

import { useActionState } from "react";
import { checkIn, verifyPresence, type ActionState } from "./actions";

export function CheckInForm({ defaultAreas }: { defaultAreas: string[] }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkIn, {});
  return (
    <form action={action} className="space-y-3">
      <div className="flex gap-3">
        {[["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
          <label key={v} className="btn-secondary flex-1 cursor-pointer gap-2">
            <input type="checkbox" name="areas" value={v} defaultChecked={defaultAreas.includes(v)} className="h-5 w-5" />
            {l}
          </label>
        ))}
      </div>
      {state.error && <p className="text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "…" : "I'm on duty"}</button>
    </form>
  );
}

/** Shown after scanning a control-room QR code: one tap to check in / confirm presence. */
export function VerifyPresenceForm({ room, code }: { room: string; code: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(verifyPresence, {});
  const name = room === "U1" ? "Utility 1" : "Utility 2";
  return (
    <form action={action} className="card space-y-3 border-brand-blue">
      <input type="hidden" name="room" value={room} /><input type="hidden" name="code" value={code} />
      <p className="section-title">You scanned the {name} control-room code</p>
      <p className="text-sm text-gray-600">Tap to check in (if you are not yet on duty) and record that you are in the control room for this shift.</p>
      {state.error && <p role="alert" className="text-sm text-crit">{state.error}</p>}
      {state.ok ? <p className="text-sm font-semibold text-ok">✓ {state.ok}</p>
        : <button className="btn-primary w-full" disabled={pending}>{pending ? "…" : `I am in the ${name} control room`}</button>}
    </form>
  );
}
