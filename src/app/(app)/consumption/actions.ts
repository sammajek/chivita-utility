"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface MeterSaveState { ok?: string; error?: string }

/** Saves the 7 am readings for one sheet. Inputs: v:<meterId>, r:<meterId> (reset), c:<meterId> (comment). */
export async function saveMeterReadings(_p: MeterSaveState, f: FormData): Promise<MeterSaveState> {
  const date = String(f.get("read_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date." };
  const fromPaper = f.get("from_paper") === "1";
  const rows = [];
  for (const [k, raw] of f.entries()) {
    if (!k.startsWith("v:")) continue;
    const id = k.slice(2);
    const v = String(raw).trim().replace(/,/g, "");
    if (!v) continue;
    const value = Number(v);
    if (!Number.isFinite(value)) return { error: `"${raw}" is not a number.` };
    const comment = String(f.get(`c:${id}`) ?? "").trim() || null;
    const isReset = f.get(`r:${id}`) === "on";
    if (isReset && !comment) return { error: "A meter reset or replacement needs a comment." };
    rows.push({ meter_id: id, read_date: date, value, is_reset: isReset, comment, recorded_by_type: "person",
                entry_method: fromPaper ? "paper" : "manual" });
  }
  if (!rows.length) return { error: "Nothing to save. Enter at least one reading." };
  const supabase = await createClient();
  const { error } = await supabase.from("meter_readings").insert(rows as never);
  if (error) {
    if (error.code === "23505") return { error: "Some of these meters already have a reading for this date. Refresh the page." };
    return { error: error.message };
  }
  revalidatePath("/consumption");
  return { ok: `Saved ${rows.length} reading(s).` };
}

export async function voidMeterReading(_p: MeterSaveState, f: FormData): Promise<MeterSaveState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_meter_reading", { p_id: String(f.get("id")), p_reason: String(f.get("reason") ?? "") });
  if (error) return { error: error.message };
  revalidatePath("/consumption");
  return { ok: "Voided. Enter the correct value." };
}
