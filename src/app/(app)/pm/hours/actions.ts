"use server";

import { revalidatePath } from "next/cache";
import { requireCap } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type State = { ok?: string; error?: string };

/** Record the last service (hours + date) for one or more running-hours intervals of a machine. */
export async function saveServices(_p: State, f: FormData): Promise<State> {
  await requireCap("engineer_tasks");
  const ids = f.getAll("interval_id").map(String);
  const supabase = await createClient();
  let n = 0;
  for (const id of ids) {
    const hours = String(f.get(`hours_${id}`) ?? "").replace(/[,\s]/g, "");
    const date = String(f.get(`date_${id}`) ?? "");
    if (!hours) continue;
    if (!/^\d+(\.\d+)?$/.test(hours)) return { error: "Hours must be a number." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Enter the date of each service you fill in." };
    const { error } = await supabase.rpc("record_service", { p_interval: id, p_hours: Number(hours), p_date: date, p_note: String(f.get("note") ?? "").trim() || "Entered on the running-hours cross-check" } as never);
    if (error) return { error: error.message };
    n++;
  }
  if (!n) return { error: "Fill in the hours and date of at least one service." };
  revalidatePath("/pm/hours");
  revalidatePath("/flags");
  return { ok: `${n} service${n === 1 ? "" : "s"} recorded. Smaller intervals restart from a bigger service.` };
}
