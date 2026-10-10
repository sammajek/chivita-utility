import { createClient } from "@/lib/supabase/server";
import type { PmFrequency, PmResult } from "@/lib/pm";

export interface PmTask {
  id: string;
  frequency: PmFrequency;
  register_sn: number;
  equipment_as_written: string;
  asset_id: string | null;
  area: "U1" | "U2";
  tasks: string[];
  hours_interval: number | null;
  document_no: string;
  asset: { code: string; name: string } | null;
}

export interface PmCompletion {
  id: string;
  task_id: string;
  period_start: string;
  result: PmResult;
  note: string | null;
  recorded_by_id: string | null;
  recorded_at: string;
  is_demo: boolean;
}

export async function loadPmTasks(freq?: PmFrequency, area?: string): Promise<PmTask[]> {
  const supabase = await createClient();
  let q = supabase
    .from("pm_tasks")
    .select("id, frequency, register_sn, equipment_as_written, asset_id, area, tasks, hours_interval, document_no, asset:assets(code, name)")
    .eq("active", true)
    .order("register_sn");
  if (freq) q = q.eq("frequency", freq);
  if (area === "U1" || area === "U2") q = q.eq("area", area);
  const { data } = await q;
  return (data ?? []) as unknown as PmTask[];
}

export async function loadPmCompletions(taskIds: string[], fromPeriod: string, toPeriod?: string): Promise<PmCompletion[]> {
  if (!taskIds.length) return [];
  const supabase = await createClient();
  const out: PmCompletion[] = [];
  // chunk the id list to keep URLs short
  for (let i = 0; i < taskIds.length; i += 150) {
    let q = supabase
      .from("pm_completions")
      .select("id, task_id, period_start, result, note, recorded_by_id, recorded_at, is_demo")
      .in("task_id", taskIds.slice(i, i + 150))
      .gte("period_start", fromPeriod)
      .is("voided_at", null)
      .limit(10000);
    if (toPeriod) q = q.lte("period_start", toPeriod);
    const { data } = await q;
    out.push(...((data ?? []) as PmCompletion[]));
  }
  return out;
}

export async function namesFor(ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (!unique.length) return names;
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name").in("id", unique);
  for (const p of data ?? []) names.set(p.id, p.full_name);
  return names;
}
