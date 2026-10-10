"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export interface AdminState {
  ok?: string;
  error?: string;
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s === "" ? null : Number(s);
};

async function done(error: { message: string } | null, msg: string): Promise<AdminState> {
  if (error) return { error: error.message };
  revalidatePath("/admin");
  return { ok: msg };
}

export async function updateUser(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({
    role: String(f.get("role")),
    active: f.get("active") === "on",
    areas: f.getAll("areas").map(String),
    staff_id: String(f.get("staff_id") ?? "").trim() || null,
    phone: String(f.get("phone") ?? "").trim() || null,
    whatsapp: String(f.get("whatsapp") ?? "").trim() || null,
  } as never).eq("id", String(f.get("id")));
  return done(error, "User updated.");
}

export async function updateParameter(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const supabase = await createClient();
  const { error } = await supabase.from("parameters").update({
    std_min: num(f.get("std_min")), std_max: num(f.get("std_max")),
    crit_min: num(f.get("crit_min")), crit_max: num(f.get("crit_max")),
    unit: String(f.get("unit") ?? "").trim() || null,
    needs_review: f.get("needs_review") === "on",
    standard_source: "Set by section manager",
  } as never).eq("id", String(f.get("id")));
  return done(error, "Limits saved (change recorded in the audit trail).");
}

export async function updateAsset(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const supabase = await createClient();
  const { error } = await supabase.from("assets").update({
    name: String(f.get("name")),
    area: String(f.get("area")) || null,
    status: String(f.get("status")),
    criticality: String(f.get("criticality") ?? "") || null,
    confirmed: f.get("confirmed") === "on",
    notes: String(f.get("notes") ?? "").trim() || null,
  } as never).eq("id", String(f.get("id")));
  return done(error, "Equipment saved.");
}

export async function confirmAlias(id: string, confirmed: boolean) {
  await requireRole("admin", "section_manager");
  const supabase = await createClient();
  await supabase.from("asset_aliases").update({ confirmed } as never).eq("id", id);
  revalidatePath("/admin");
}

export async function setMonitor(id: string, monitor: boolean) {
  await requireRole("admin", "section_manager");
  const supabase = await createClient();
  await supabase.from("registers").update({ monitor } as never).eq("id", id);
  revalidatePath("/admin");
}

export async function updateSetting(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const supabase = await createClient();
  const raw = String(f.get("value") ?? "").trim();
  let value: unknown = raw;
  try { value = JSON.parse(raw); } catch { /* keep as string */ }
  const { error } = await supabase.from("app_settings").update({ value, updated_at: new Date().toISOString() } as never).eq("key", String(f.get("key")));
  return done(error, "Setting saved.");
}
