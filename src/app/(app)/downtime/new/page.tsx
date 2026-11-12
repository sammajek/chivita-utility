import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadAssetsForPicker, loadLists } from "@/lib/data/lists";
import { lagosDate, lagosParts, shiftAt } from "@/lib/time";
import { DowntimeForm, type Cause, type DowntimeDefaults } from "../DowntimeForm";

export const dynamic = "force-dynamic";

const hhmm = (iso: string) => {
  const p = lagosParts(new Date(iso));
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

export default async function NewDowntimePage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const profile = await requireProfile();
  const { id } = await searchParams;
  const supabase0 = await createClient();
  const [lists, assets, { data: causes }, { data: gi }] = await Promise.all([loadLists(), loadAssetsForPicker(),
    supabase0.from("downtime_causes").select("downtime_type, equipment_category, failure_category, failure_mode, issue_descriptions").eq("active", true).order("sort"),
    supabase0.from("app_settings").select("value").eq("key", "downtime_general_issues").maybeSingle()]);
  let d: DowntimeDefaults = { date: lagosDate(new Date()), shift: shiftAt(new Date()).shift, start_time: hhmm(new Date().toISOString()), status: "Open" };

  if (id) {
    const supabase = await createClient();
    const { data: e } = await supabase.from("downtime_events").select("*").eq("id", id).single();
    if (e) {
      const ev = e as Record<string, string | number | null>;
      const start = String(ev.start_at);
      const end = ev.end_at ? String(ev.end_at) : null;
      const sameOrNext = end && (new Date(end).getTime() - new Date(start).getTime()) < 86_400_000;
      d = {
        id, asset_id: String(ev.asset_id), date: lagosDate(new Date(start)), shift: String(ev.shift), start_time: hhmm(start),
        end_time: end ? hhmm(end) : "", end_date: end && !sameOrNext ? lagosDate(new Date(end)) : "",
        downtime_type: String(ev.downtime_type), failure_category: String(ev.failure_category), failure_mode: String(ev.failure_mode),
        issue_description: (ev.issue_description as string) ?? "", immediate_stop: Boolean(ev.immediate_stop),
        planned_hours: ev.planned_hours?.toString() ?? "", override_hours: ev.override_hours?.toString() ?? "",
        override_reason: (ev.override_reason as string) ?? "", immediate_action: (ev.immediate_action as string) ?? "",
        spares_used: (ev.spares_used as string) ?? "", attended_by: (ev.attended_by as string) ?? "",
        production_impact: (ev.production_impact as string) ?? "", status: String(ev.status), remarks: (ev.remarks as string) ?? "",
      };
    }
  }
  const canClose = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  return (
    <div className="space-y-4">
      <h1 className="page-title">{id ? "Update downtime event" : "Log downtime"}</h1>
      <p className="page-sub">603-001 Utility Downtime Analysis template, with causes tailored to each machine. An unplanned breakdown of ≥ 4 h or a 3rd repeat opens a draft RCA automatically.</p>
      <DowntimeForm lists={lists} assets={assets} d={d} canClose={canClose} causes={(causes ?? []) as Cause[]} generalIssues={(gi?.value as string[]) ?? []} />
    </div>
  );
}
