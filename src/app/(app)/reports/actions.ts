"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { PERIODS } from "@/lib/deck/period";
import { SECTION_KEYS } from "@/lib/deck/sections";

type Msg = { ok?: string; error?: string };
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

/** Saves the Reports form (sections, area, template) as a named template, optionally scheduled. */
export async function saveDeckTemplate(_p: Msg, f: FormData): Promise<Msg> {
  const sections = SECTION_KEYS.filter((k) => f.get(`s:${k}`) === "on");
  const name = s(f, "save_name");
  if (!name || name.length < 3) return { error: "Give the template a name." };
  if (!sections.length) return { error: "Tick at least one section." };
  const schedule = s(f, "schedule") ?? "none";
  const period = s(f, "period") ?? "last_week";
  if (!(period in PERIODS)) return { error: "Pick a period." };
  const area = s(f, "area");
  const supabase = await createClient();
  const { error } = await supabase.from("deck_templates").insert({
    name, template: s(f, "template") ?? "custom", title: s(f, "title"), sections, area: area === "U1" || area === "U2" ? area : null,
    period, shared: f.get("shared") === "on", schedule,
    schedule_dow: schedule === "weekly" ? Number(s(f, "schedule_dow") ?? 1) : null,
    schedule_day: schedule === "monthly" ? Number(s(f, "schedule_day") ?? 1) : null,
    schedule_hour: Number(s(f, "schedule_hour") ?? 7),
    recipients: schedule === "none" ? [] : f.getAll("recipients").map(String),
  } as never);
  if (error) return { error: error.message.includes("row-level security") ? "Only engineers and managers can schedule reports." : error.message };
  revalidatePath("/reports");
  return { ok: "Template saved." };
}

export async function retireDeckTemplate(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.from("deck_templates").update({ active: false } as never).eq("id", String(f.get("id")));
  if (error) return { error: error.message };
  revalidatePath("/reports");
  return { ok: "Removed." };
}
