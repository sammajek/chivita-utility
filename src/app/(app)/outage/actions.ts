"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { lagosInstant } from "@/lib/time";

type Msg = { ok?: string; error?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** "YYYY-MM-DD" + "HH:MM" (Lagos) → instant; blank → now. */
function when(f: FormData, d: string, t: string) {
  const date = s(f, d), time = s(f, t);
  if (!date || !time) return new Date();
  const [h, m] = time.split(":").map(Number);
  return lagosInstant(date, h, m);
}

export async function declareOutage(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("declare_outage", { p_reason: s(f, "reason"), p_started_at: when(f, "date", "time").toISOString() });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Outage declared. Missing-reading flags are paused." };
}

export async function endOutage(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_outage", { p_id: s(f, "id"), p_ended_at: when(f, "date", "time").toISOString(), p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath("/", "layout");
  return { ok: "Outage ended. Enter the paper readings now." };
}
