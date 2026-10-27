import { AppHeader } from "@/components/AppHeader";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const { data: outage } = profile.active
    ? await (await createClient()).from("system_outages").select("started_at, reason").is("ended_at", null).maybeSingle()
    : { data: null };
  return (
    <>
      <AppHeader profile={profile} />
      {!profile.active && (
        <div className="bg-amber-50 px-4 py-2 text-center text-sm text-warn">
          Your account is not active yet. Ask an admin to set your role.
        </div>
      )}
      {outage && (
        <div className="no-print bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white">
          Outage declared: {outage.reason}. Log on paper if needed; missing-reading flags are paused. <Link href="/outage" className="underline">Outage plan</Link>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
