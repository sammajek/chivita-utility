"use client";

import { useActionState } from "react";
import { checkIn, checkOut, verifyPresence, type ActionState } from "./actions";

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

export function CheckOutForm({ openFlags }: { openFlags: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(checkOut, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="text-sm font-medium">Handover note (required)</span>
        <textarea name="handover" rows={4} className="input" placeholder="Equipment status, issues, what the next shift should watch…" required minLength={10} />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="ack" className="mt-1 h-5 w-5" />
        I have reviewed the {openFlags} open flag(s) for my areas and passed them on in this handover.
      </label>
      {state.error && <p className="text-sm text-crit">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok">{state.ok}</p>}
      <button className="btn-secondary w-full" disabled={pending}>{pending ? "…" : "Check out"}</button>
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
