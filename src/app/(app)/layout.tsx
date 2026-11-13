import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { signOut } from "@/app/login/actions";
import { navForProfile, requireProfile } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data: outage }, { count: unread }] = profile.active
    ? await Promise.all([
        supabase.from("system_outages").select("started_at, reason").is("ended_at", null).maybeSingle(),
        supabase.from("notifications").select("id", { count: "exact", head: true })
          .eq("recipient_id", profile.id).or("channel.eq.in_app,kind.neq.report").is("acknowledged_at", null),
      ])
    : [{ data: null }, { count: 0 }];
  const banners = (
    <>
      {!profile.active && (
        <div className="bg-amber-50 px-4 py-2 text-center text-sm text-warn">Your account is not active yet. Ask an admin to set your role.</div>
      )}
      {outage && (
        <div className="no-print bg-red-600 px-4 py-2 text-center text-sm font-semibold text-white">
          Outage declared: {outage.reason}. Log on paper if needed; missing-reading flags are paused. <Link href="/outage" className="underline">Outage plan</Link>
        </div>
      )}
    </>
  );
  return (
    <AppShell nav={navForProfile(profile)} name={profile.full_name} roleLabel={ROLE_LABELS[profile.role]} unread={unread ?? 0}
      signOut={signOut} banners={banners}>
      {children}
    </AppShell>
  );
}
