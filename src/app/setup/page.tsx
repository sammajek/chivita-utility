import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { isSupabaseConfigured } from "@/lib/env";

export default function SetupPage() {
  if (isSupabaseConfigured) redirect("/");
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <Logo height={51} />
      <h1 className="mt-6 text-2xl font-bold">Database not connected yet</h1>
      <p className="mt-3 text-gray-700">
        The app is installed but has no Supabase project keys. Add <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to <code>.env.local</code> (local) or to the Vercel project
        settings, then reload.
      </p>
    </main>
  );
}
