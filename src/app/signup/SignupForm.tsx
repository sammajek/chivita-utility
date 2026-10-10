"use client";

import Link from "next/link";
import { useActionState } from "react";
import { requestAccess, type SignupState } from "./actions";

export function SignupForm() {
  const [state, action, pending] = useActionState<SignupState, FormData>(requestAccess, {});
  if (state.done) {
    return (
      <div className="space-y-3 text-sm text-gray-700">
        <p className="font-medium text-gray-900">Request sent.</p>
        <p>
          If email confirmation is switched on, open the link we emailed you first. Then an admin will set your role
          and activate your account. Until then you can sign in but will not see plant data.
        </p>
        <Link href="/login" className="btn-primary block w-full text-center">
          Back to sign in
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="space-y-4">
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Full name</span>
        <input name="full_name" autoComplete="name" required className="input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Work email</span>
        <input name="email" type="email" autoComplete="email" required className="input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Password (8+ characters)</span>
        <input name="password" type="password" autoComplete="new-password" minLength={8} required className="input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Confirm password</span>
        <input name="confirm" type="password" autoComplete="new-password" minLength={8} required className="input" />
      </label>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Sending…" : "Request access"}
      </button>
    </form>
  );
}
