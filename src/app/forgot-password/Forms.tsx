"use client";

import { useActionState } from "react";
import { requestReset, setNewPassword, type ResetState } from "./actions";

export function RequestResetForm() {
  const [s, action, pending] = useActionState<ResetState, FormData>(requestReset, {});
  if (s.ok) return <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">{s.ok}</p>;
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
        <input name="email" type="email" autoComplete="email" required className="input" />
      </label>
      {s.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{s.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Sending…" : "Send reset link"}</button>
    </form>
  );
}

export function NewPasswordForm() {
  const [s, action, pending] = useActionState<ResetState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">New password</span>
        <input name="password" type="password" autoComplete="new-password" minLength={8} required className="input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Type it again</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className="input" />
      </label>
      {s.error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">{s.error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Saving…" : "Save new password"}</button>
    </form>
  );
}
