import Link from "next/link";
import { Logo } from "@/components/Logo";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Logo height={51} />
          <h1 className="text-xl font-bold text-gray-900">Utility Ops</h1>
          <p className="text-sm text-gray-600">Engineering Department, Utility Section</p>
        </div>
        <div className="card">
          <LoginForm next={next ?? "/"} />
        </div>
        <p className="mt-6 text-center text-xs text-gray-500">
          No account?{" "}
          <Link href="/signup" className="font-medium text-brand-blue underline">
            Request access
          </Link>{" "}
          — an admin activates it.
        </p>
      </div>
    </main>
  );
}
