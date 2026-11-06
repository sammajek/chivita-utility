import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { prefillHandover } from "@/lib/data/handover";
import { SHIFT_LABELS } from "@/lib/time";
import { HandoverForm } from "./HandoverForm";

export const dynamic = "force-dynamic";

export default async function NewHandover() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: session } = await supabase.from("duty_sessions").select("id, shift_date, shift, areas")
    .eq("profile_id", profile.id).is("checked_out_at", null).order("checked_in_at", { ascending: false }).limit(1).maybeSingle();
  if (!session) {
    return (
      <div className="space-y-3">
        <h1 className="page-title">Write handover</h1>
        <p className="card text-sm text-gray-600">You are not checked in. <Link href="/duty" className="text-brand-blue">Check in on the On duty page</Link> first.</p>
      </div>
    );
  }
  const s = session as { id: string; shift_date: string; shift: "day" | "night"; areas: string[] };
  const [prefill, { data: setting }, { count }] = await Promise.all([
    prefillHandover(s.areas, s.shift_date, s.shift),
    supabase.from("app_settings").select("value").eq("key", "handover_checklist").maybeSingle(),
    supabase.from("flags").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Utility handover report</h1>
        <p className="page-sub">{SHIFT_LABELS[s.shift]} · {s.shift_date} · {s.areas.map((a) => (a === "U1" ? "Utility 1" : "Utility 2")).join(" & ")}. Submitting checks you out; the incoming engineer acknowledges it and a manager signs it.</p>
      </div>
      <HandoverForm prefill={prefill} checklist={(setting?.value as string[]) ?? []} openFlags={count ?? 0} />
    </div>
  );
}
