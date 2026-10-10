"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

type State = { ok?: string; error?: string };

export async function togglePlan(form: FormData) {
  const supabase = await createClient();
  await supabase.rpc("set_amc_plan", {
    p_contract: String(form.get("contract_id")),
    p_month: String(form.get("month")),
    p_planned: form.get("planned") === "1",
  } as never);
  revalidatePath("/amc");
}

export async function recordVisit(_prev: State, form: FormData): Promise<State> {
  const visitDate = String(form.get("visit_date") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) return { error: "Enter the visit date." };
  const cost = String(form.get("cost_ngn") ?? "").replace(/[,\s]/g, "");
  if (cost && Number.isNaN(Number(cost))) return { error: "Cost must be a number." };
  const supabase = await createClient();
  const { error } = await supabase.from("amc_visits").insert({
    contract_id: String(form.get("contract_id")),
    month: `${visitDate.slice(0, 7)}-01`,
    visit_date: visitDate,
    vendor_rep: String(form.get("vendor_rep") ?? "").trim() || null,
    findings: String(form.get("findings") ?? "").trim() || null,
    recommendations: String(form.get("recommendations") ?? "").trim() || null,
    cost_ngn: cost ? Number(cost) : null,
    recorded_by_type: "person",
  });
  if (error) {
    if (error.code === "23505") return { error: "A visit is already recorded for this contract in that month." };
    return { error: error.message };
  }
  revalidatePath("/amc");
  return { ok: "Visit recorded." };
}

export async function voidVisit(_prev: State, form: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("void_amc_visit", {
    p_id: String(form.get("id")),
    p_reason: String(form.get("reason") ?? "").trim(),
  } as never);
  if (error) return { error: error.message };
  revalidatePath("/amc");
  return { ok: "Voided." };
}

export async function addContract(_prev: State, form: FormData): Promise<State> {
  const description = String(form.get("description") ?? "").trim().toUpperCase();
  const vendor = String(form.get("vendor") ?? "").trim().toUpperCase();
  if (!description || !vendor) return { error: "Enter the description and the vendor." };
  const area = String(form.get("area") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("amc_contracts").insert({
    description, vendor, area: area === "U1" || area === "U2" ? area : null,
    start_date: String(form.get("start_date") || "") || null,
    end_date: String(form.get("end_date") || "") || null,
  });
  if (error) return { error: error.message };
  revalidatePath("/amc");
  return { ok: "Contract added." };
}
