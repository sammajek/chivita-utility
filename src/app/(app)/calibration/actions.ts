"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type State = { ok?: string; error?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

export async function recordCalibration(_prev: State, f: FormData): Promise<State> {
  const result = str(f, "result");
  if (result === "fail" && !str(f, "notes")) return { error: "Describe the failure and the action taken." };
  const supabase = await createClient();
  const { error } = await supabase.from("calibrations").insert({
    instrument_id: str(f, "instrument_id"), calibrated_on: str(f, "calibrated_on"), result,
    certificate_no: str(f, "certificate_no"), vendor: str(f, "vendor"), notes: str(f, "notes"), recorded_by_type: "person",
  });
  if (error) return { error: error.message };
  revalidatePath("/calibration");
  return { ok: "Calibration recorded." };
}

export async function saveInstrument(_prev: State, f: FormData): Promise<State> {
  const tag = str(f, "tag")?.toUpperCase();
  const description = str(f, "description");
  if (!tag || !description) return { error: "Enter the tag and the description." };
  const months = Number(f.get("interval_months") || 12);
  const area = str(f, "area");
  const row = {
    tag, description, instrument_type: str(f, "instrument_type") ?? "Pressure gauge",
    asset_id: str(f, "asset_id"), area: area === "U1" || area === "U2" ? area : null, location: str(f, "location"),
    range_text: str(f, "range_text"), interval_months: months, last_calibrated: str(f, "last_calibrated"), notes: str(f, "notes"),
  };
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = id ? await supabase.from("instruments").update(row).eq("id", id) : await supabase.from("instruments").insert(row);
  if (error) return { error: error.code === "23505" ? "That tag already exists." : error.message };
  revalidatePath("/calibration");
  return { ok: id ? "Instrument updated." : "Instrument added." };
}

export async function voidCalibration(_prev: State, f: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_calibration", { p_id: str(f, "id"), p_reason: str(f, "reason") ?? "" } as never);
  if (error) return { error: error.message };
  revalidatePath("/calibration");
  return { ok: "Voided." };
}
