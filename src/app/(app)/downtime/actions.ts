"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lagosInstant } from "@/lib/time";

export interface FormState {
  error?: string;
}

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** Date + Start time + End time like the template; End Date only if the stoppage ran past the next morning. */
function times(f: FormData) {
  const date = s(f, "date")!;
  const [sh, sm] = (s(f, "start_time") ?? "00:00").split(":").map(Number);
  const start = lagosInstant(date, sh, sm);
  const endT = s(f, "end_time");
  let end: Date | null = null;
  if (endT) {
    const [eh, em] = endT.split(":").map(Number);
    const endDate = s(f, "end_date");
    end = lagosInstant(endDate ?? date, eh, em);
    if (!endDate && end <= start) end = new Date(end.getTime() + 86_400_000); // ran past midnight
  }
  return { start, end };
}

export async function saveDowntime(_prev: FormState, f: FormData): Promise<FormState> {
  const id = s(f, "id");
  const { start, end } = times(f);
  const override = s(f, "override_hours");
  const row = {
    asset_id: s(f, "asset_id"),
    shift: s(f, "shift"),
    downtime_type: s(f, "downtime_type"),
    failure_category: s(f, "failure_category"),
    failure_mode: s(f, "failure_mode"),
    issue_description: s(f, "issue_description"),
    start_at: start.toISOString(),
    end_at: end?.toISOString() ?? null,
    override_hours: override ? Number(override) : null,
    override_reason: s(f, "override_reason"),
    immediate_action: s(f, "immediate_action"),
    spares_used: s(f, "spares_used"),
    attended_by: s(f, "attended_by"),
    production_impact: s(f, "production_impact"),
    status: s(f, "status") ?? "Open",
    remarks: s(f, "remarks"),
  };
  if (!row.asset_id || !row.downtime_type || !row.failure_category || !row.failure_mode || !row.shift) {
    return { error: "Fill in equipment, shift, downtime type, failure category and failure mode." };
  }
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("downtime_events").update(row as never).eq("id", id).select("id").single()
    : await supabase.from("downtime_events").insert({ ...row, recorded_by_type: "person" } as never).select("id").single();
  if (error) return { error: error.message.includes("check constraint") ? "Override hours need a reason." : error.message };
  revalidatePath("/downtime");
  redirect(`/downtime?saved=${(data as { id: string }).id}`);
}

export async function saveRca(_prev: FormState, f: FormData): Promise<FormState> {
  const id = s(f, "id");
  const row = {
    downtime_id: s(f, "downtime_id"),
    asset_id: s(f, "asset_id"),
    problem: s(f, "problem"),
    why1: s(f, "why1"), why2: s(f, "why2"), why3: s(f, "why3"), why4: s(f, "why4"), why5: s(f, "why5"),
    root_cause: s(f, "root_cause"),
    category_6m: s(f, "category_6m"),
    corrective_action: s(f, "corrective_action"),
    preventive_action: s(f, "preventive_action"),
    action_type: s(f, "action_type"),
    capex_required: f.get("capex_required") === "on",
    capex_amount_ngn: s(f, "capex_amount_ngn") ? Number(s(f, "capex_amount_ngn")) : null,
    cost_ngn: s(f, "cost_ngn") ? Number(s(f, "cost_ngn")) : null,
    target_date: s(f, "target_date"),
    status: s(f, "status") ?? "Not Started",
    effectiveness_note: s(f, "effectiveness_note"),
  };
  if (!row.asset_id || !row.problem) return { error: "Equipment and problem statement are required." };
  const supabase = await createClient();
  const { data, error } = id
    ? await supabase.from("rcas").update(row as never).eq("id", id).select("id").single()
    : await supabase.from("rcas").insert(row as never).select("id").single();
  if (error) return { error: error.message };
  revalidatePath("/rca");
  redirect(`/rca/${(data as { id: string }).id}?saved=1`);
}
