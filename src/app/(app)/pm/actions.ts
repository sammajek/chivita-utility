"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface PmSaveState {
  ok?: boolean;
  saved?: number;
  error?: string;
}

/** Saves the PM results ticked for one period. Inputs: r:<taskId> = result, n:<taskId> = note. */
export async function savePm(_prev: PmSaveState, form: FormData): Promise<PmSaveState> {
  const period = String(form.get("period_start"));
  const rows = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("r:")) continue;
    const taskId = k.slice(2);
    const result = String(v);
    if (!["done_ok", "not_done", "done_not_ok"].includes(result)) continue;
    const note = String(form.get(`n:${taskId}`) ?? "").trim() || null;
    if (result !== "done_ok" && !note) {
      return { error: "Add a note for every PM marked Not done or Done, not OK." };
    }
    rows.push({ task_id: taskId, period_start: period, result, note, recorded_by_type: "person" });
  }
  if (!rows.length) return { error: "Nothing to save. Tick at least one PM." };
  const supabase = await createClient();
  const { error } = await supabase.from("pm_completions").insert(rows);
  if (error) {
    if (error.code === "23505") return { error: "Some of these PMs were already recorded for this period. Refresh the page." };
    return { error: error.message };
  }
  revalidatePath("/pm");
  return { ok: true, saved: rows.length };
}

export async function voidPm(_prev: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_pm_completion", {
    p_id: String(form.get("id")),
    p_reason: String(form.get("reason") ?? "").trim(),
  } as never);
  if (error) return { error: error.message };
  revalidatePath("/pm");
  return { ok: "Voided. You can enter it again." };
}
