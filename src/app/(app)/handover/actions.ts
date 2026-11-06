"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { HANDOVER_GROUPS, type HandoverContent } from "@/lib/handover";

export interface Msg { ok?: string; error?: string }
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Builds the handover from the form (fields named g:<group>:<running|standby|faults>, wtp:<field>, ck:<n>, cn:<n>). */
export async function submitHandover(_p: Msg, f: FormData): Promise<Msg> {
  const items = JSON.parse(s(f, "checklist_items") || "[]") as string[];
  const content: HandoverContent = {
    groups: Object.fromEntries(HANDOVER_GROUPS.map((g) => [g.key, {
      running: s(f, `g:${g.key}:running`), standby: s(f, `g:${g.key}:standby`), faults: s(f, `g:${g.key}:faults`),
    }])),
    fuel: s(f, "fuel"),
    wtp: {
      raw_running: s(f, "wtp:raw_running"), treated_running: s(f, "wtp:treated_running"), standby: s(f, "wtp:standby"),
      ph: s(f, "wtp:ph"), raw_level: s(f, "wtp:raw_level"), treated_level: s(f, "wtp:treated_level"), faults: s(f, "wtp:faults"),
    },
    caustic: s(f, "caustic"),
    checklist: Object.fromEntries(items.map((item, i) => [item, { answer: (s(f, `ck:${i}`) || "") as "yes" | "no" | "na", note: s(f, `cn:${i}`) || undefined }])),
  };
  const missing = items.filter((_, i) => !s(f, `ck:${i}`)).length;
  if (missing) return { error: `Answer every checklist item (${missing} left).` };
  if (items.some((_, i) => s(f, `ck:${i}`) === "no" && s(f, `cn:${i}`).length < 3)) return { error: 'Add a note for every item answered "No".' };
  const faults = HANDOVER_GROUPS.map((g) => content.groups[g.key].faults && `${g.label}: ${content.groups[g.key].faults}`).filter(Boolean);
  const summary = [faults.length ? `Maintenance/faults – ${faults.join("; ")}` : "No equipment faults reported", s(f, "footnote")].filter(Boolean).join(". ");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("submit_handover", { p_content: content, p_footnote: s(f, "footnote"), p_summary: summary });
  if (error) return { error: error.message };
  revalidatePath("/handover");
  revalidatePath("/duty");
  redirect(`/handover/${data}`);
}

export async function receiveHandover(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_handover", { p_id: s(f, "id"), p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath("/handover");
  return { ok: "Acknowledged." };
}

export async function signHandover(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_handover", { p_id: s(f, "id"), p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath("/handover");
  return { ok: "Signed." };
}
