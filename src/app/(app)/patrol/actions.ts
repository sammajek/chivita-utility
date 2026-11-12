"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";

export interface Msg { ok?: string; error?: string }
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addPoint(_p: Msg, f: FormData): Promise<Msg> {
  const checks = s(f, "checks").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  const supabase = await createClient();
  const { error } = await supabase.from("patrol_points").insert({
    name: s(f, "name"), area: s(f, "area"), location: s(f, "location") || null,
    rounds_per_shift: Number(s(f, "rounds") || 1), ...(checks.length ? { checks } : {}),
  } as never);
  if (error) return { error: error.code === "23505" ? "A patrol point with that name exists." : error.message };
  revalidatePath("/patrol");
  return { ok: "Patrol point added. Issue its code and print the label." };
}

export interface LabelState { error?: string; svg?: string; name?: string }

/** New code for a point (old label stops working) and its QR label. */
export async function issueLabel(_p: LabelState, f: FormData): Promise<LabelState> {
  const supabase = await createClient();
  const id = s(f, "id");
  const { data, error } = await supabase.rpc("issue_patrol_code", { p_point: id });
  if (error) return { error: error.message };
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const url = `${base}/patrol/scan?p=${id}&c=${encodeURIComponent(String(data))}`;
  revalidatePath("/patrol");
  return { name: s(f, "name"), svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) };
}

export interface VisitState { error?: string; visitId?: string }

export async function recordVisit(_p: VisitState, f: FormData): Promise<VisitState> {
  const checks = JSON.parse(s(f, "checks") || "[]") as string[];
  const answers = Object.fromEntries(checks.map((c, i) => [c, s(f, `a:${i}`)]));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_patrol_visit", { p_point: s(f, "point"), p_code: s(f, "code"), p_answers: answers, p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath("/patrol");
  return { visitId: String(data) };
}

/** Edit a patrol point (managers). */
export async function updatePoint(_p: Msg, f: FormData): Promise<Msg> {
  const checks = s(f, "checks").split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!checks.length) return { error: "Keep at least one check." };
  const supabase = await createClient();
  const { error } = await supabase.from("patrol_points").update({
    name: s(f, "name"), area: s(f, "area"), location: s(f, "location") || null, rounds_per_shift: Number(s(f, "rounds") || 1), checks,
  } as never).eq("id", s(f, "id"));
  if (error) return { error: error.code === "23505" ? "A patrol point with that name exists." : error.message };
  revalidatePath("/patrol");
  return { ok: "Saved." };
}

/** Remove a patrol point (managers). It is retired, not erased: its past rounds stay on record and no more rounds are expected. */
export async function removePoint(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.from("patrol_points").update({ active: false, code_hash: null } as never).eq("id", s(f, "id"));
  if (error) return { error: error.message };
  revalidatePath("/patrol");
  return { ok: "Patrol point removed." };
}
