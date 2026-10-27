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

const t = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** Staff record: contact details and pre-approval (email + role → their sign-up is activated with that role). */
export async function saveStaff(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const supabase = await createClient();
  const row = {
    staff_id: t(f, "staff_id"), surname: t(f, "surname"), first_name: t(f, "first_name"),
    band: t(f, "band") ? Number(t(f, "band")) : null, job_title: t(f, "job_title"), area: t(f, "area"),
    email: t(f, "email"), phone: t(f, "phone"), whatsapp: t(f, "whatsapp"), app_role: t(f, "app_role"),
    default_shift: t(f, "default_shift"), active: f.get("active") !== null ? f.get("active") === "on" : true, team: "Utility",
  };
  if (!row.staff_id || !row.surname || !row.first_name) return { error: "Staff ID, surname and first name are required." };
  const id = t(f, "id");
  const { error } = id
    ? await supabase.from("staff").update(row as never).eq("id", id)
    : await supabase.from("staff").insert(row as never);
  if (error) return { error: error.code === "23505" ? "That staff ID or email is already used." : error.message };
  await supabase.rpc("link_staff_profiles");
  return done(null, "Staff saved.");
}

/**
 * Bulk import pasted from Excel/CSV. Columns (header row required, any order):
 * staff_id, surname, first_name, band, job_title, area, email, phone, whatsapp, role, shift
 */
export async function importStaffCsv(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin");
  const text = String(f.get("csv") ?? "").trim();
  if (!text) return { error: "Paste the rows first." };
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = lines[0].includes("\t") ? "\t" : ",";
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, "_"));
  const col = (n: string) => head.indexOf(n);
  if (col("staff_id") < 0 || col("surname") < 0 || col("first_name") < 0) {
    return { error: "The first row must name the columns, including staff_id, surname and first_name." };
  }
  const roles = ["operator", "engineer", "shift_manager", "section_manager", "admin", "viewer"];
  const rows = [];
  for (const [n, line] of lines.slice(1).entries()) {
    const c = line.split(sep).map((v) => v.trim());
    const g = (k: string) => (col(k) >= 0 ? c[col(k)] || null : null);
    const role = g("role")?.toLowerCase().replace(/\s+/g, "_") ?? null;
    if (role && !roles.includes(role)) return { error: `Row ${n + 2}: unknown role "${g("role")}".` };
    const area = g("area")?.toUpperCase() ?? null;
    if (area && !["U1", "U2"].includes(area)) return { error: `Row ${n + 2}: area must be U1 or U2.` };
    const full: Record<string, unknown> = {
      staff_id: g("staff_id"), surname: g("surname"), first_name: g("first_name"), band: g("band") ? Number(g("band")) : null,
      job_title: g("job_title"), area, email: g("email"), phone: g("phone"), whatsapp: g("whatsapp"), app_role: role,
      default_shift: g("shift")?.toLowerCase() ?? null,
    };
    // only columns present in the pasted header are written, so a partial sheet never blanks other details
    const src: Record<string, string> = { app_role: "role", default_shift: "shift" };
    rows.push(Object.fromEntries(Object.entries(full).filter(([k]) => col(src[k] ?? k) >= 0)));
  }
  const supabase = await createClient();
  const { error } = await supabase.from("staff").upsert(rows as never, { onConflict: "staff_id" });
  if (error) return { error: error.message };
  await supabase.rpc("link_staff_profiles");
  return done(null, `${rows.length} staff imported / updated.`);
}
