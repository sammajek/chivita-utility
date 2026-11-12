"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { HANDOVER_GROUPS, summarise, type GroupStatus, type HandoverContent, type MachineItem, type MachineStatus } from "@/lib/handover";

export interface Msg { ok?: string; error?: string }
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** Ticked machines for a prefix: fields `<prefix>:<code>` = status, `<prefix>-name:<code>` = name. */
function machines(f: FormData, prefix: string): MachineItem[] | null {
  const out: MachineItem[] = [];
  for (const [k, v] of f.entries()) {
    if (!k.startsWith(`${prefix}:`)) continue;
    const code = k.slice(prefix.length + 1);
    out.push({ code, name: s(f, `${prefix}-name:${code}`), status: String(v) as MachineStatus });
  }
  return out.length ? out : null;
}

function group(f: FormData, key: string): GroupStatus {
  const items = machines(f, `m:${key}`);
  if (!items) return { running: s(f, `g:${key}:running`), standby: s(f, `g:${key}:standby`), faults: s(f, `g:${key}:faults`) };
  const note = s(f, `m:${key}-note`);
  return { ...summarise(items, note), items, note };
}

/** Builds the shift handover from the form and submits it (writer is checked out). */
export async function submitHandover(_p: Msg, f: FormData): Promise<Msg> {
  const items = JSON.parse(s(f, "checklist_items") || "[]") as string[];
  const wtpItems = machines(f, "w");
  const wtpNote = s(f, "w-note");
  const wtpSum = wtpItems ? summarise(wtpItems, wtpNote) : null;
  const content: HandoverContent = {
    groups: Object.fromEntries(HANDOVER_GROUPS.map((g) => [g.key, group(f, g.key)])),
    fuel: s(f, "fuel"),
    wtp: {
      raw_running: s(f, "wtp:raw_count"), treated_running: s(f, "wtp:treated_count"),
      raw_count: s(f, "wtp:raw_count"), treated_count: s(f, "wtp:treated_count"),
      ph_raw: s(f, "wtp:ph_raw"), ph_treated: s(f, "wtp:ph_treated"),
      standby: wtpSum ? wtpSum.standby : s(f, "wtp:standby"),
      ph: "", raw_level: s(f, "wtp:raw_level"), treated_level: s(f, "wtp:treated_level"),
      faults: wtpSum ? wtpSum.faults : s(f, "wtp:faults"),
      ...(wtpItems ? { items: wtpItems, note: wtpNote } : {}),
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

/** Team-mate checks out once the shift's handover is written. */
export async function checkOutCovered(): Promise<Msg> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("check_out_covered");
  if (error) return { error: error.message };
  revalidatePath("/duty");
  revalidatePath("/handover");
  redirect(`/handover/${data}`);
}

export async function addHandoverNote(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_handover_note", { p_id: s(f, "id"), p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath(`/handover/${s(f, "id")}`);
  return { ok: "Note added to the handover." };
}

export async function receiveHandover(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("receive_handover", { p_id: s(f, "id"), p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath("/handover");
  revalidatePath("/duty");
  return { ok: "Acknowledged." };
}

export async function signHandover(_p: Msg, f: FormData): Promise<Msg> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_handover", { p_id: s(f, "id"), p_note: s(f, "note") });
  if (error) return { error: error.message };
  revalidatePath("/handover");
  return { ok: "Signed." };
}
