"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type Msg = { ok?: string; error?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** Tick a training as done, or record not attended / postponed / cancelled. */
export async function setTrainingStatus(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_training_status", {
    p_id: s(f, "id"), p_status: s(f, "status"), p_date: s(f, "date"), p_note: s(f, "note"),
  });
  if (error) return { error: error.message };
  revalidatePath("/training");
  return { ok: "Saved." };
}

/** Add a training need for a staff member (existing course, or a new course title). */
export async function addTraining(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  let courseId = s(f, "course_id");
  const newTitle = s(f, "new_course");
  if (!courseId && newTitle) {
    const { data, error } = await supabase.from("training_courses")
      .upsert({ title: newTitle, provider: s(f, "provider"), duration: s(f, "duration") } as never, { onConflict: "title" })
      .select("id").single();
    if (error) return { error: error.message };
    courseId = (data as { id: string }).id;
  }
  if (!courseId || !s(f, "staff_ref")) return { error: "Pick the person and the course." };
  const start = s(f, "start"), end = s(f, "end") ?? start;
  const { error } = await supabase.from("training_plans").insert({
    staff_ref: s(f, "staff_ref"), course_id: courseId, fy: s(f, "fy") ?? "FY2026",
    planned_start: start, planned_end: end, planned_text: start ? (start === end ? start : `${start} to ${end}`) : null,
    provider: s(f, "provider"), recorded_by_type: "person",
  } as never);
  if (error) return { error: error.message };
  revalidatePath("/training");
  return { ok: "Training added." };
}

export async function voidTraining(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_training_plan", { p_id: s(f, "id"), p_reason: s(f, "reason") });
  if (error) return { error: error.message };
  revalidatePath("/training");
  return { ok: "Removed." };
}
