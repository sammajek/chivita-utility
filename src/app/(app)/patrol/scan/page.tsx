import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { VisitForm } from "../Forms";

export const dynamic = "force-dynamic";

/** Opened by scanning a patrol point's QR label. */
export default async function ScanPage({ searchParams }: { searchParams: Promise<{ p?: string; c?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = sp.p ? await supabase.from("patrol_points").select("id, name, area, area_label, location, checks").eq("id", sp.p).eq("active", true).maybeSingle() : { data: null };
  if (!data || !sp.c) return <p className="card text-sm">This patrol label is not recognised. <Link href="/patrol" className="text-brand-blue">Patrols</Link></p>;
  const pt = data as { id: string; name: string; area: string | null; area_label: string | null; location: string | null; checks: string[] };
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">{pt.name}</h1>
        <p className="page-sub">Patrol point · {pt.area_label ?? (pt.area === "U1" ? "Utility 1" : "Utility 2")}{pt.location ? ` · ${pt.location}` : ""}. Check each item and record the round.</p>
      </div>
      {profile.active && can(profile, "enter_records")
        ? <VisitForm point={pt.id} code={sp.c} name={pt.name} checks={pt.checks} />
        : <p className="card text-sm text-gray-600">Your account cannot record patrol rounds.</p>}
    </div>
  );
}
