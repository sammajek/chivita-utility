import Link from "next/link";
import { Logo } from "@/components/Logo";
import { createClient } from "@/lib/supabase/server";
import { NewPasswordForm } from "../forgot-password/Forms";

export const dynamic = "force-dynamic";

/** Reached from the reset email (the link signs the person in first through /auth/confirm). */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo height={51} />
          <h1 className="text-xl font-bold text-gray-900">Choose a New Password</h1>
          {user?.email && <p className="text-sm text-gray-600">For {user.email}</p>}
        </div>
        <div className="card">
          {user ? <NewPasswordForm /> : (
            <p className="text-sm text-gray-700">This reset link has expired or was opened on another device. <Link href="/forgot-password" className="font-medium text-brand-blue underline">Ask for a new link</Link>.</p>
          )}
        </div>
      </div>
    </main>
  );
}
