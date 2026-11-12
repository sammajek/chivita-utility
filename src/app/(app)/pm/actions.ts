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
  const resolves: { id: string; result: string; note: string | null }[] = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("r:")) continue;
    const taskId = k.slice(2);
    const result = String(v);
    if (!["done_ok", "done_not_ok", "pending", "not_done"].includes(result)) continue;
    const note = String(form.get(`n:${taskId}`) ?? "").trim() || null;
    const until = String(form.get(`d:${taskId}`) ?? "").trim() || null;
    if ((result === "done_not_ok" || result === "not_done") && !note) {
      return { error: "Add a note for every PM marked “Completed – issue found” or “Skipped”." };
    }
    if (result === "pending" && !until) return { error: "Give the date each pending PM will be done by." };
    const pendingId = String(form.get(`p:${taskId}`) ?? "");
    if (pendingId) { resolves.push({ id: pendingId, result, note }); continue; }
    rows.push({ task_id: taskId, period_start: period, result, note, pending_until: result === "pending" ? until : null, recorded_by_type: "person" });
  }
  if (!rows.length && !resolves.length) return { error: "Nothing to save. Tick at least one PM." };
  const supabase = await createClient();
  for (const r of resolves) {
    if (r.result === "pending") return { error: "A pending PM must now be completed or skipped." };
    const { error: e } = await supabase.rpc("resolve_pending_pm", { p_id: r.id, p_result: r.result, p_note: r.note });
    if (e) return { error: e.message };
  }
  const { error } = rows.length ? await supabase.from("pm_completions").insert(rows) : { error: null };
  if (error) {
    if (error.code === "23505") return { error: "Some of these PMs were already recorded for this period. Refresh the page." };
    return { error: error.message };
  }
  revalidatePath("/pm");
  return { ok: true, saved: rows.length + resolves.length };
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

/** Engineer / manager affirms (signs off) the PM for one frequency, area and period. */
export async function affirmPm(_prev: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("affirm_pm_period", {
    p_freq: String(form.get("freq")), p_area: String(form.get("area")),
    p_period: String(form.get("period_start")), p_note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/pm");
  return { ok: "PM affirmed." };
}

export async function voidAffirmation(_prev: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_pm_affirmation", { p_id: String(form.get("id")), p_reason: String(form.get("reason") ?? "") });
  if (error) return { error: error.message };
  revalidatePath("/pm");
  return { ok: "Affirmation withdrawn." };
}

/** Engineer's on-site spot-check of a completed PM. */
export async function checkSpot(_prev: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_pm_spot", {
    p_id: String(form.get("id")), p_result: String(form.get("result") ?? ""), p_note: String(form.get("note") ?? "").trim() || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/pm");
  return { ok: "Spot-check saved." };
}
