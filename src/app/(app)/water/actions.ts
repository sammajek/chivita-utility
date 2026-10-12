"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type State = { ok?: string; error?: string };

/** Inputs: v:<testId> value, c:<testId> comment, a:<testId> action; t:<testId>=1 for text tests. */
export async function saveWater(_prev: State, f: FormData): Promise<State> {
  const sampledOn = String(f.get("sampled_on") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sampledOn)) return { error: "Enter the sample date." };
  const rows = [];
  for (const [k, raw] of f.entries()) {
    if (!k.startsWith("v:")) continue;
    const id = k.slice(2);
    const value = String(raw).trim();
    if (!value) continue;
    const isText = f.get(`t:${id}`) === "1";
    const n = Number(value.replace(",", "."));
    if (!isText && Number.isNaN(n)) return { error: `"${value}" is not a number.` };
    rows.push({
      test_id: id, sampled_on: sampledOn,
      value_num: isText ? null : n, value_text: isText ? value : null,
      comment: String(f.get(`c:${id}`) ?? "").trim() || null,
      action_taken: String(f.get(`a:${id}`) ?? "").trim() || null,
      recorded_by_type: "person",
    });
  }
  if (!rows.length) return { error: "Nothing to save. Enter at least one result." };
  const supabase = await createClient();
  const { error } = await supabase.from("water_results").insert(rows);
  if (error) {
    if (error.code === "23505") return { error: "Some of these results were already entered for this date. Refresh the page." };
    return { error: error.message };
  }
  revalidatePath("/water");
  return { ok: `Saved ${rows.length} result(s).` };
}

export async function voidWater(_prev: State, f: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_water_result", {
    p_id: String(f.get("id")), p_reason: String(f.get("reason") ?? "").trim(),
  } as never);
  if (error) return { error: error.message };
  revalidatePath("/water");
  return { ok: "Voided." };
}
