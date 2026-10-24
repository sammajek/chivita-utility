"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Msg = { ok?: string; error?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

function refresh(code: string | null) {
  revalidatePath("/equipment");
  if (code) revalidatePath(`/equipment/${code}`);
}

/** Available / standby / unavailable (with reason: PM, Breakdown, CBM, …). */
export async function setState(_p: Msg, f: FormData): Promise<Msg> {
  const state = s(f, "state");
  const reason = state === "available" ? null : s(f, "reason");
  if (state === "unavailable" && !reason) return { error: "Pick why it is unavailable." };
  if (reason === "Other" && !s(f, "note")) return { error: "Describe the reason." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_asset_state", {
    p_asset: s(f, "asset_id"), p_state: state, p_reason: reason, p_note: s(f, "note"),
  });
  if (error) return { error: error.message };
  refresh(s(f, "code"));
  return { ok: "State updated." };
}

export async function recordService(_p: Msg, f: FormData): Promise<Msg> {
  const hours = Number(s(f, "hours"));
  if (!Number.isFinite(hours) || hours < 0) return { error: "Enter the running hours at the service." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_service", {
    p_interval: s(f, "interval_id"), p_hours: hours, p_date: s(f, "date"), p_note: s(f, "note"),
  });
  if (error) return { error: error.message };
  refresh(s(f, "code"));
  return { ok: "Service recorded." };
}

export async function updateInterval(_p: Msg, f: FormData): Promise<Msg> {
  await requireRole("engineer", "shift_manager", "section_manager", "admin");
  const supabase = await createClient();
  const { error } = await supabase.from("service_intervals").update({
    warn_before_hours: Number(s(f, "warn") ?? 200),
    active: f.get("active") === "on",
  } as never).eq("id", s(f, "id"));
  if (error) return { error: error.message };
  refresh(s(f, "code"));
  return { ok: "Saved." };
}

/** PM code and specifications (admin / section manager). */
export async function updateSpecs(_p: Msg, f: FormData): Promise<Msg> {
  await requireRole("admin", "section_manager");
  const year = s(f, "year_installed");
  const supabase = await createClient();
  const { error } = await supabase.from("assets").update({
    pm_code: s(f, "pm_code"), make: s(f, "make"), model: s(f, "model"), serial_no: s(f, "serial_no"),
    capacity: s(f, "capacity"), location: s(f, "location"), specs: s(f, "specs"),
    year_installed: year ? Number(year) : null, criticality: s(f, "criticality"),
  } as never).eq("id", s(f, "asset_id"));
  if (error) return { error: error.message };
  refresh(s(f, "code"));
  return { ok: "Saved (change recorded in the audit trail)." };
}
