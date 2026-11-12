import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { prefillHandover } from "@/lib/data/handover";
import { namesFor } from "@/lib/data/pm";
import { formatLagos, SHIFT_LABELS } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { checkOutCovered } from "../actions";
import { HandoverForm } from "./HandoverForm";

export const dynamic = "force-dynamic";

const areaName = (a: string) => (a === "U1" ? "Utility 1" : "Utility 2");

/** Write the shift's handover (once, by anyone on the shift), or check out when a team-mate already wrote it. */
export default async function NewHandover() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data: session } = await supabase.from("duty_sessions").select("id, shift_date, shift, areas")
    .eq("profile_id", profile.id).is("checked_out_at", null).order("checked_in_at", { ascending: false }).limit(1).maybeSingle();
  if (!session) {
    return (
      <div className="space-y-3">
        <h1 className="page-title">Write Handover</h1>
        <p className="card text-sm text-gray-600">You are not checked in. <Link href="/duty" className="text-brand-blue">Check in on the On duty page</Link> first.</p>
      </div>
    );
  }
  const s = session as { id: string; shift_date: string; shift: "day" | "night"; areas: string[] };
  const [{ data: team }, { data: existing }] = await Promise.all([
    supabase.from("duty_sessions").select("profile_id, areas, checked_out_at").eq("shift_date", s.shift_date).eq("shift", s.shift).eq("is_demo", false),
    supabase.from("handovers").select("id, recorded_by_id, recorded_at").eq("shift_date", s.shift_date).eq("shift", s.shift).eq("is_demo", false).maybeSingle(),
  ]);
  const members = (team ?? []) as { profile_id: string; areas: string[]; checked_out_at: string | null }[];
  const names = await namesFor([...members.map((m) => m.profile_id), existing?.recorded_by_id ?? null]);
  const areas = [...new Set(members.flatMap((m) => m.areas))].sort();
  const teamLine = members.map((m) => `${names.get(m.profile_id) ?? "—"} (${m.areas.join("+")}${m.checked_out_at ? ", checked out" : ""})`).join(" · ");

  if (existing) {
    return (
      <div className="space-y-4">
        <h1 className="page-title">Shift Handover Already Written</h1>
        <div className="card space-y-3 text-sm">
          <p><b>{names.get(existing.recorded_by_id) ?? "A team-mate"}</b> wrote the handover for this shift ({SHIFT_LABELS[s.shift]} · {s.shift_date}) at {formatLagos(existing.recorded_at)}. It covers everyone on duty: {teamLine}.</p>
          <p className="text-gray-600">Read it and add anything missing as a note, then check out.</p>
          <div className="flex flex-wrap items-start gap-2">
            <Link href={`/handover/${existing.id}`} className="btn-secondary">Open the handover / add a note</Link>
            <ActionForm action={checkOutCovered} submit="Check out (covered by this handover)" className="inline"><span /></ActionForm>
          </div>
        </div>
      </div>
    );
  }

  const [prefill, { data: setting }, { count }] = await Promise.all([
    prefillHandover(areas, s.shift_date, s.shift),
    supabase.from("app_settings").select("value").eq("key", "handover_checklist").maybeSingle(),
    supabase.from("flags").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Utility Handover Report</h1>
        <p className="page-sub">{SHIFT_LABELS[s.shift]} · {s.shift_date} · {areas.map(areaName).join(" & ")}. One report for the whole shift: anyone on duty can write it, the others then check out “covered”. Anyone on the next shift acknowledges it.</p>
        <p className="mt-1 text-xs text-gray-500">On duty this shift: {teamLine}</p>
      </div>
      <HandoverForm prefill={prefill} checklist={(setting?.value as string[]) ?? []} openFlags={count ?? 0} />
    </div>
  );
}
