"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseLoggerCsv } from "@/lib/logger-csv";

export interface KeyState { ok?: string; error?: string; key?: string }

/** Creates a logger (or issues it a new key). The key is shown once. */
export async function issueKey(_p: KeyState, f: FormData): Promise<KeyState> {
  const supabase = await createClient();
  const area = String(f.get("area") ?? "");
  const { data, error } = await supabase.rpc("issue_logger_key", {
    p_name: String(f.get("name") ?? ""), p_description: String(f.get("description") ?? ""), p_area: area === "U1" || area === "U2" ? area : null,
  });
  if (error) return { error: error.message };
  revalidatePath("/loggers");
  return { ok: "Key issued. Copy it now: it is not shown again. Any previous key for this logger stops working.", key: String(data) };
}

export interface UploadState { ok?: string; error?: string; errors?: string[] }

export async function uploadCsv(_p: UploadState, f: FormData): Promise<UploadState> {
  const file = f.get("file");
  const text = file instanceof File && file.size ? await file.text() : String(f.get("csv") ?? "");
  if (text.length > 5_000_000) return { error: "File too large (max 5 MB); split it." };
  const { rows, errors } = parseLoggerCsv(text);
  if (!rows.length) return { error: errors[0] ?? "No rows found.", errors };
  const supabase = await createClient();
  const out = { slots: 0, meters: 0, stored: 0, rejected: 0, reasons: [] as string[] };
  for (let i = 0; i < rows.length; i += 2000) {
    const { data, error } = await supabase.rpc("logger_csv_ingest", { p_logger: String(f.get("logger_id")), p_rows: rows.slice(i, i + 2000) });
    if (error) return { error: error.message };
    const r = data as { register_slots: number; meter_readings: number; stored_only: number; rejected: number; errors: { row: number; reason: string }[] };
    out.slots += r.register_slots; out.meters += r.meter_readings; out.stored += r.stored_only; out.rejected += r.rejected;
    out.reasons.push(...r.errors.slice(0, 20).map((e) => `Row ${e.row + i + 1}: ${e.reason}`));
  }
  revalidatePath("/loggers");
  return {
    ok: `${rows.length} rows: ${out.slots} filled register slots, ${out.meters} became 07:00 meter readings, ${out.stored} kept as logger data, ${out.rejected} rejected.`,
    errors: [...errors, ...out.reasons].slice(0, 30),
  };
}
