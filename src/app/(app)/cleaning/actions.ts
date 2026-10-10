"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type State = { ok?: string; error?: string };

/** Inputs: c:<zoneId>:<activityId> = done | not_done, n:<zoneId>:<activityId> = note. */
export async function saveCleaning(_prev: State, form: FormData): Promise<State> {
  const week = String(form.get("week_start"));
  const rows = [];
  for (const [k, v] of form.entries()) {
    if (!k.startsWith("c:")) continue;
    const [, zone, activity] = k.split(":");
    const result = String(v);
    if (result !== "done" && result !== "not_done") continue;
    const note = String(form.get(`n:${zone}:${activity}`) ?? "").trim() || null;
    if (result === "not_done" && !note) return { error: "Give a reason for every activity marked Not done." };
    rows.push({ week_start: week, zone_id: Number(zone), activity_id: Number(activity), result, note, recorded_by_type: "person" });
  }
  if (!rows.length) return { error: "Nothing to save. Tick at least one activity." };
  const supabase = await createClient();
  const { error } = await supabase.from("cleaning_checks").insert(rows);
  if (error) {
    if (error.code === "23505") return { error: "Some of these were already recorded this week. Refresh the page." };
    return { error: error.message };
  }
  revalidatePath("/cleaning");
  return { ok: `Saved ${rows.length}.` };
}

export async function signOff(_prev: State, form: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.from("cleaning_signoffs").insert({
    week_start: String(form.get("week_start")),
    comment: String(form.get("comment") ?? "").trim() || null,
  });
  if (error) return { error: error.code === "23505" ? "Already signed off." : error.message };
  revalidatePath("/cleaning");
  return { ok: "Week signed off." };
}

export async function voidCleaning(_prev: State, form: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_cleaning_check", {
    p_id: String(form.get("id")),
    p_reason: String(form.get("reason") ?? "").trim(),
  } as never);
  if (error) return { error: error.message };
  revalidatePath("/cleaning");
  return { ok: "Voided." };
}
