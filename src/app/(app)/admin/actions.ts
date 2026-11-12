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
    rated_output: String(f.get("rated_output") ?? "").trim() === "" ? null : Number(String(f.get("rated_output")).replace(",", ".")),
    rated_unit: String(f.get("rated_unit") ?? "").trim() || null,
    ...(f.get("category_id") ? { category_id: Number(f.get("category_id")) } : {}),
    make: txt(f, "make"), model: txt(f, "model"), capacity: txt(f, "capacity"), location: txt(f, "location"),
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

/** Admin gives someone a temporary password (they should change it after signing in: menu → Change password). */
export async function setTempPassword(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin");
  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_set_temp_password", { p_user: String(f.get("id")), p_password: String(f.get("password") ?? "") });
  if (error) return { error: error.message };
  return { ok: "Temporary password set. Give it to the person and ask them to change it (menu → Change password)." };
}

const lines = (v: FormDataEntryValue | null) => String(v ?? "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** Edit or add a downtime cause (type → equipment category → failure category → failure mode → issue descriptions). */
export async function saveCause(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const id = String(f.get("id") ?? "");
  const row = {
    downtime_type: String(f.get("downtime_type") ?? ""),
    equipment_category: String(f.get("equipment_category") ?? "") || null,
    failure_category: String(f.get("failure_category") ?? "").trim(),
    failure_mode: String(f.get("failure_mode") ?? "").trim(),
    issue_descriptions: lines(f.get("issue_descriptions")),
    active: id ? f.get("active") === "on" : true,
  };
  if (!row.downtime_type || row.failure_category.length < 3 || row.failure_mode.length < 3) return { error: "Type, failure category and failure mode are needed." };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("downtime_causes").update(row as never).eq("id", id)
    : await supabase.from("downtime_causes").insert({ ...row, sort: 10000 } as never);
  if (error?.code === "23505") return { error: "That cause already exists for this downtime type and equipment." };
  return done(error, id ? "Saved." : "Cause added.");
}

const txt = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** Add a new machine to the equipment list. */
export async function addAsset(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const code = String(f.get("code") ?? "").trim().toUpperCase();
  const name = String(f.get("name") ?? "").trim();
  if (!/^[A-Z0-9][A-Z0-9-]{1,20}$/.test(code)) return { error: "Code: letters, numbers and dashes (e.g. CMP-14)." };
  if (name.length < 3) return { error: "Enter the equipment name." };
  const supabase = await createClient();
  const { error } = await supabase.from("assets").insert({
    code, name, category_id: Number(f.get("category_id")), area: txt(f, "area"), make: txt(f, "make"), model: txt(f, "model"),
    capacity: txt(f, "capacity"), location: txt(f, "location"), criticality: txt(f, "criticality"), confirmed: true,
  } as never);
  if (error?.code === "23505") return { error: `${code} already exists.` };
  return done(error, `${code} added. Add it to its register(s) on the Registers tab and to PM tasks if needed.`);
}

/** Edit or add a PM task (library row). */
export async function savePmTask(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const id = String(f.get("id") ?? "");
  const tasks = lines(f.get("tasks"));
  const row = {
    equipment_as_written: String(f.get("equipment") ?? "").trim(),
    frequency: String(f.get("frequency") ?? ""),
    area: String(f.get("area") ?? "U1"),
    asset_id: txt(f, "asset_id"),
    tasks,
    hours_interval: num(f.get("hours_interval")),
    active: id ? f.get("active") === "on" : true,
  };
  if (row.equipment_as_written.length < 3 || !tasks.length) return { error: "Enter the equipment and at least one task (one per line)." };
  const supabase = await createClient();
  let error;
  if (id) ({ error } = await supabase.from("pm_tasks").update(row as never).eq("id", id));
  else {
    const { data: mx } = await supabase.from("pm_tasks").select("register_sn").order("register_sn", { ascending: false }).limit(1);
    ({ error } = await supabase.from("pm_tasks").insert({ ...row, register_sn: ((mx?.[0]?.register_sn as number) ?? 0) + 1 } as never));
  }
  if (error?.code === "23505") return { error: "A task with that equipment and frequency already exists." };
  return done(error, id ? "PM task saved." : "PM task added.");
}

/** Put a machine on a register or take it off (nothing is deleted). */
export async function setRegisterAsset(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const register_id = String(f.get("register_id")), asset_id = String(f.get("asset_id") ?? "");
  if (!asset_id) return { error: "Choose a machine." };
  const on = String(f.get("on")) === "1";
  const supabase = await createClient();
  const { error } = await supabase.from("register_assets").upsert({ register_id, asset_id, active: on, sort: 50 } as never, { onConflict: "register_id,asset_id" });
  return done(error, on ? "Machine added to the register." : "Machine taken off the register.");
}

/** Pick-list values: add, hide / show, or reorder. Values already used in records are never renamed. */
export async function saveListItem(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const list_name = String(f.get("list_name")), value = String(f.get("value") ?? "").trim();
  if (value.length < 2) return { error: "Enter the value." };
  const supabase = await createClient();
  const exists = f.get("existing") === "1";
  const { error } = exists
    ? await supabase.from("lists").update({ active: f.get("active") === "on", sort: Number(f.get("sort") || 0) } as never).eq("list_name", list_name).eq("value", value)
    : await supabase.from("lists").insert({ list_name, value, sort: Number(f.get("sort") || 99) } as never);
  if (error?.code === "23505") return { error: "That value is already in the list." };
  return done(error, exists ? "Saved." : "Added.");
}

/** Cleaning schedule zones (one per weekday) and activities. */
export async function saveCleaningZone(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const id = String(f.get("id") ?? "");
  const row = { name: String(f.get("name") ?? "").trim(), area: String(f.get("area") ?? "U1"), day_of_week: Number(f.get("day")), active: id ? f.get("active") === "on" : true };
  if (row.name.length < 3) return { error: "Describe the zone." };
  const supabase = await createClient();
  const { error } = id ? await supabase.from("cleaning_zones").update(row as never).eq("id", Number(id)) : await supabase.from("cleaning_zones").insert(row as never);
  if (error?.code === "23505") return { error: "That weekday already has a zone: edit it instead." };
  return done(error, "Zone saved.");
}

export async function saveCleaningActivity(_p: AdminState, f: FormData): Promise<AdminState> {
  await requireRole("admin", "section_manager");
  const id = String(f.get("id") ?? "");
  const name = String(f.get("name") ?? "").trim();
  if (name.length < 3) return { error: "Describe the activity." };
  const supabase = await createClient();
  let error;
  if (id) ({ error } = await supabase.from("cleaning_activities").update({ name, active: f.get("active") === "on" } as never).eq("id", Number(id)));
  else {
    const { data: mx } = await supabase.from("cleaning_activities").select("sort").order("sort", { ascending: false }).limit(1);
    ({ error } = await supabase.from("cleaning_activities").insert({ name, sort: ((mx?.[0]?.sort as number) ?? 0) + 1 } as never));
  }
  return done(error, "Activity saved.");
}
