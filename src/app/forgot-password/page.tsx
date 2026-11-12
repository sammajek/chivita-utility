import Link from "next/link";
import { Logo } from "@/components/Logo";
import { RequestResetForm } from "./Forms";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo height={51} />
          <h1 className="text-xl font-bold text-gray-900">Reset your password</h1>
          <p className="text-sm text-gray-600">Enter the email you sign in with. We will email you a link to choose a new password.</p>
        </div>
        <div className="card"><RequestResetForm /></div>
        <p className="mt-6 text-center text-xs text-gray-500">
          <Link href="/login" className="font-medium text-brand-blue underline">Back to sign in</Link> · No email arriving? Ask an admin to set a temporary password for you (Admin → Users).
        </p>
      </div>
    </main>
  );
}
