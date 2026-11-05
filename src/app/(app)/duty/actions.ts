"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export interface ActionState {
  ok?: string;
  error?: string;
}

export async function checkIn(_prev: ActionState, form: FormData): Promise<ActionState> {
  const areas = form.getAll("areas").map(String).filter((a) => a === "U1" || a === "U2");
  if (areas.length === 0) return { error: "Pick Utility 1, Utility 2 or both." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_in", { p_areas: areas } as never);
  if (error) return { error: error.message };
  revalidatePath("/duty");
  revalidatePath("/");
  return { ok: "You are on duty." };
}

export async function checkOut(_prev: ActionState, form: FormData): Promise<ActionState> {
  if (form.get("ack") !== "on") return { error: "Tick the box to confirm you have reviewed the open flags." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("check_out", { p_handover: String(form.get("handover") ?? "") } as never);
  if (error) return { error: error.message };
  revalidatePath("/duty");
  revalidatePath("/");
  return { ok: "Checked out. Handover saved." };
}

export async function acknowledgeFlag(id: string) {
  const supabase = await createClient();
  await supabase.rpc("acknowledge_flag", { p_id: id } as never);
  revalidatePath("/flags");
}

export async function resolveFlag(_prev: ActionState, form: FormData): Promise<ActionState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_flag", { p_id: String(form.get("id")), p_note: String(form.get("note") ?? "") } as never);
  if (error) return { error: error.message };
  revalidatePath("/flags");
  return { ok: "Closed." };
}

/** Scanned control-room QR: verify presence (and check in for that area if not yet on duty). */
export async function verifyPresence(_prev: ActionState, form: FormData): Promise<ActionState> {
  const area = String(form.get("room"));
  if (area !== "U1" && area !== "U2") return { error: "Unknown control room." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("verify_presence", { p_area: area, p_code: String(form.get("code") ?? "") } as never);
  if (error) return { error: error.message };
  revalidatePath("/duty");
  revalidatePath("/");
  return { ok: `Verified: you are on duty in the ${area === "U1" ? "Utility 1" : "Utility 2"} control room.` };
}
