"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface SaveState {
  ok?: boolean;
  saved?: number;
  error?: string;
}

/**
 * Saves the values entered for one register slot. Each input is named
 * v:<fieldId>; comments c:<fieldId>; actions a:<fieldId>. The database
 * stamps who/when, works out in/out of spec and rejects out-of-spec values
 * without a comment.
 */
export async function saveReadings(_prev: SaveState, form: FormData): Promise<SaveState> {
  const registerKey = String(form.get("register_key"));
  const assetId = String(form.get("asset_id") || "");
  const logDate = String(form.get("log_date"));
  const slotKey = String(form.get("slot_key"));
  const readingFor = String(form.get("reading_for"));
  const fieldAsset = JSON.parse(String(form.get("field_assets") || "{}")) as Record<string, string>;
  const numeric = new Set(JSON.parse(String(form.get("numeric_fields") || "[]")) as string[]);

  const rows = [];
  for (const [k, raw] of form.entries()) {
    if (!k.startsWith("v:")) continue;
    const fieldId = k.slice(2);
    const value = String(raw).trim();
    if (value === "") continue;
    const isNum = numeric.has(fieldId);
    const num = isNum ? Number(value.replace(",", ".")) : null;
    if (isNum && Number.isNaN(num)) return { error: `"${value}" is not a number.` };
    rows.push({
      field_id: fieldId,
      asset_id: fieldAsset[fieldId] ?? assetId,
      log_date: logDate,
      slot_key: slotKey,
      reading_for: readingFor,
      value_num: num,
      value_text: isNum ? null : value,
      comment: String(form.get(`c:${fieldId}`) ?? "").trim() || null,
      action_taken: String(form.get(`a:${fieldId}`) ?? "").trim() || null,
      recorded_by_type: "person",
    });
  }
  if (rows.length === 0) return { error: "Nothing to save. Enter at least one value." };

  const supabase = await createClient();
  const { error } = await supabase.from("readings").insert(rows);
  if (error) {
    if (error.code === "23505") return { error: "Some of these values were already entered for this slot. Refresh the page." };
    return { error: error.message };
  }
  revalidatePath(`/registers/${registerKey}`);
  return { ok: true, saved: rows.length };
}

/**
 * Corrects or voids a saved reading. Both need a reason, which the database
 * writes to the audit log with the old and new values.
 */
export async function correctReading(_prev: { ok?: string; error?: string }, form: FormData): Promise<{ ok?: string; error?: string }> {
  const supabase = await createClient();
  const id = String(form.get("id"));
  const reason = String(form.get("reason") ?? "").trim();
  if (reason.length < 5) return { error: "Give a reason (5+ characters)." };
  if (form.get("mode") === "void") {
    const { error } = await supabase.rpc("void_reading", { p_id: id, p_reason: reason } as never);
    if (error) return { error: error.message };
  } else {
    const isNum = form.get("numeric") === "1";
    const value = String(form.get("value") ?? "").trim().replace(",", ".");
    if (value === "") return { error: "Enter the corrected value." };
    if (isNum && Number.isNaN(Number(value))) return { error: `"${value}" is not a number.` };
    const { error } = await supabase.rpc("amend_reading", {
      p_id: id,
      p_value_num: isNum ? Number(value) : null,
      p_value_text: isNum ? null : value,
      p_comment: String(form.get("comment") ?? "").trim() || null,
      p_action: null,
      p_reason: reason,
    } as never);
    if (error) return { error: error.message };
  }
  revalidatePath(String(form.get("path") || "/registers"));
  return { ok: form.get("mode") === "void" ? "Voided." : "Corrected." };
}
