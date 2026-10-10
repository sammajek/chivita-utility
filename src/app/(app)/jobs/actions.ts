"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type State = { ok?: string; error?: string };

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;
function money(f: FormData, k: string): number | null | "bad" {
  const v = String(f.get(k) ?? "").replace(/[,\s₦]/g, "");
  if (!v) return null;
  return Number.isNaN(Number(v)) ? "bad" : Number(v);
}

export async function saveJob(_prev: State, f: FormData): Promise<State> {
  const value = money(f, "po_value_ngn");
  if (value === "bad") return { error: "PO value must be a number." };
  const row = {
    request_date: str(f, "request_date"),
    cs_number: str(f, "cs_number"),
    description: str(f, "description"),
    brk_number: str(f, "brk_number"),
    status: str(f, "status") ?? "Pending",
    po_number: str(f, "po_number"),
    po_value_ngn: value,
    vendor: str(f, "vendor"),
    execution: str(f, "execution"),
    jcc_completed: f.get("jcc_completed") === "on",
    payment_completed: f.get("payment_completed") === "on",
    remarks: str(f, "remarks"),
  };
  if (!row.description) return { error: "Enter the job description." };
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = id
    ? await supabase.from("job_requests").update(row).eq("id", id)
    : await supabase.from("job_requests").insert({ ...row, recorded_by_type: "person" });
  if (error) return { error: error.message };
  revalidatePath("/jobs");
  return { ok: id ? "Updated." : "Job request added." };
}

export async function saveOrder(_prev: State, f: FormData): Promise<State> {
  const value = money(f, "po_value_ngn");
  if (value === "bad") return { error: "PO value must be a number." };
  const row = {
    order_date: str(f, "order_date"),
    mrs_number: str(f, "mrs_number"),
    items: str(f, "items"),
    prn_number: str(f, "prn_number"),
    status: str(f, "status") ?? "Pending",
    po_number: str(f, "po_number"),
    po_value_ngn: value,
    vendor: str(f, "vendor"),
    received_date: str(f, "received_date"),
    remarks: str(f, "remarks"),
  };
  if (!row.items) return { error: "Enter the items ordered." };
  const supabase = await createClient();
  const id = str(f, "id");
  const { error } = id
    ? await supabase.from("item_orders").update(row).eq("id", id)
    : await supabase.from("item_orders").insert({ ...row, recorded_by_type: "person" });
  if (error) return { error: error.message };
  revalidatePath("/jobs");
  return { ok: id ? "Updated." : "Item order added." };
}

export async function voidJobRecord(_prev: State, f: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_job_record", {
    p_table: String(f.get("table")),
    p_id: String(f.get("id")),
    p_reason: String(f.get("reason") ?? "").trim(),
  } as never);
  if (error) return { error: error.message };
  revalidatePath("/jobs");
  return { ok: "Voided." };
}
