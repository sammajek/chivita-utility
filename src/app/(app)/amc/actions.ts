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
  const description = String(form.get("description") ?? "").trim();
  const vendor = String(form.get("vendor") ?? "").trim();
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

/** Edit a contract's details (managers). */
export async function updateContract(_prev: State, form: FormData): Promise<State> {
  const description = String(form.get("description") ?? "").trim();
  const vendor = String(form.get("vendor") ?? "").trim();
  if (!description || !vendor) return { error: "Enter the description and the vendor." };
  const area = String(form.get("area") ?? "");
  const supabase = await createClient();
  const { error } = await supabase.from("amc_contracts").update({
    description, vendor, area: area === "U1" || area === "U2" ? area : null,
    start_date: String(form.get("start_date") || "") || null,
    end_date: String(form.get("end_date") || "") || null,
    notes: String(form.get("notes") ?? "").trim() || null,
  } as never).eq("id", String(form.get("id")));
  if (error) return { error: error.code === "23505" ? "Another contract has that description." : error.message };
  revalidatePath("/amc");
  return { ok: "Saved." };
}

/** End (remove) a contract: it leaves the tracker and raises no more flags; its visit history is kept. */
export async function endContract(_prev: State, form: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("end_amc_contract", { p_id: String(form.get("id")), p_reason: String(form.get("reason") ?? "").trim() });
  if (error) return { error: error.message };
  revalidatePath("/amc");
  revalidatePath("/flags");
  return { ok: "Contract ended and removed from the tracker." };
}

export async function reactivateContract(_prev: State, form: FormData): Promise<State> {
  const supabase = await createClient();
  const { error } = await supabase.from("amc_contracts").update({ active: true, end_date: null } as never).eq("id", String(form.get("id")));
  if (error) return { error: error.message };
  revalidatePath("/amc");
  return { ok: "Contract back on the tracker." };
}

/** Managers/admin: tick the months of a year that have a planned visit for one contract. */
export async function savePlanYear(_prev: State, form: FormData): Promise<State> {
  const year = Number(form.get("year"));
  const months = form.getAll("month").map(Number).filter((m) => m >= 1 && m <= 12);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_amc_plan_year", { p_contract: String(form.get("contract_id")), p_year: year, p_months: months } as never);
  if (error) return { error: error.message };
  revalidatePath("/amc");
  revalidatePath("/flags");
  return { ok: `Planned months for ${year} saved (${months.length} month${months.length === 1 ? "" : "s"}).` };
}
