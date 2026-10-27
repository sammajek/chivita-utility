"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Msg = { ok?: string; error?: string };
const FIELDS = ["gemba_raised", "gemba_closed", "unsafe_observed", "unsafe_reported", "near_miss", "non_routine_jobs", "permits_issued",
  "permits_carried", "leaks_identified", "leaks_closed_24h", "leaks_escalated", "thermax_callouts", "thermax_acted", "thermax_escalated"] as const;

/** Weekly log (one row per engineer per week, Monday start). Saving again updates the week (audit-logged). */
export async function saveWeeklyLog(_p: Msg, f: FormData): Promise<Msg> {
  const row: Record<string, unknown> = {
    staff_ref: String(f.get("staff_ref")), week_start: String(f.get("week_start")),
    notes: String(f.get("notes") ?? "").trim() || null, recorded_by_type: "person",
  };
  for (const k of FIELDS) {
    const v = String(f.get(k) ?? "").trim();
    if (v === "") { row[k] = null; continue; }
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0) return { error: `"${v}" is not a whole number.` };
    row[k] = n;
  }
  const pairs: [string, string, string][] = [["gemba_closed", "gemba_raised", "GEMBA closed"], ["unsafe_reported", "unsafe_observed", "Unsafe acts reported"],
    ["leaks_closed_24h", "leaks_identified", "Leaks closed"], ["thermax_acted", "thermax_callouts", "THERMAX acted on"]];
  for (const [a, b, l] of pairs) {
    if (row[a] != null && row[b] != null && (row[a] as number) > (row[b] as number)) return { error: `${l} cannot be more than the total.` };
  }
  const supabase = await createClient();
  const { error } = await supabase.from("engineer_weekly_logs").upsert(row as never, { onConflict: "staff_ref,week_start" });
  if (error) return { error: error.message.includes("row-level security") ? "You can only fill in your own weekly log." : error.message };
  revalidatePath("/kpi");
  return { ok: "Week saved." };
}
