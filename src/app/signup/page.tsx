import Link from "next/link";
import { Logo } from "@/components/Logo";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo height={51} />
          <h1 className="text-xl font-bold text-gray-900">Request access</h1>
          <p className="text-sm text-gray-600">Utility Ops, Engineering Department</p>
        </div>
        <div className="card">
          <SignupForm />
        </div>
        <p className="mt-6 text-center text-xs text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-brand-blue underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
