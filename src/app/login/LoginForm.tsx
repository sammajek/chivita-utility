"use client";

import { PasswordInput } from "@/components/PasswordInput";

import Link from "next/link";
import { useActionState } from "react";
import { signIn, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(signIn, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Email</span>
        <input name="email" type="email" autoComplete="email" required className="input" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-gray-700">Password</span>
        <PasswordInput name="password" autoComplete="current-password" required className="input" />
      </label>
      <p className="-mt-2 text-right text-sm"><Link href="/forgot-password" className="font-medium text-brand-blue underline">Forgot password?</Link></p>
      {state.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-crit">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
