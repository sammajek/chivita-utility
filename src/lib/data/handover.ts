import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";
import { HANDOVER_GROUPS, summarise, type GroupStatus, type HandoverContent, type MachineItem } from "@/lib/handover";

export { HANDOVER_GROUPS, type GroupStatus, type HandoverContent };

interface Asset { code: string; name: string; area: string | null; op_state: string; op_reason: string | null; category: { name: string } | null }

const statusOf = (a: Asset): MachineItem["status"] => (a.op_state === "available" ? "running" : a.op_state === "standby" ? "standby" : a.op_state === "unavailable" ? "fault" : "");

/** Pre-fills a handover from the app: each machine ticked from its state, the 07:00 fuel readings and the latest WTP readings. */
export async function prefillHandover(areas: string[], shiftDate: string, shift: "day" | "night"): Promise<Omit<HandoverContent, "checklist">> {
  const supabase = await createClient();
  const [{ data: a }, { data: fuel }, { data: params }] = await Promise.all([
    supabase.from("assets").select("code, name, area, op_state, op_reason, category:asset_categories(name)").neq("status", "retired").order("code"),
    supabase.from("meter_usage").select("code, name, unit, used").eq("grp", "daily").eq("read_date", shift === "day" ? shiftDate : addDays(shiftDate, 1)),
    supabase.from("parameters").select("id, name, unit").in("name", ["Raw Water Tank Level", "Process Water Tank Level", "pH", "Treated Water pH", "Raw Water pH"]),
  ]);
  const assets = ((a ?? []) as unknown as Asset[]).filter((x) => !x.area || areas.includes(x.area));
  const reasons = (xs: Asset[]) => xs.filter((x) => x.op_state === "unavailable" && x.op_reason).map((x) => `${x.code}: ${x.op_reason}`).join("; ");
  const groups: Record<string, GroupStatus> = {};
  for (const g of HANDOVER_GROUPS) {
    const xs = assets.filter((x) => g.cats.includes(x.category?.name ?? "") && (!g.nameHas || x.name.includes(g.nameHas)));
    // a group with no equipment in the register (e.g. fire hydrant) still gets one tick-box row
    const items: MachineItem[] = xs.length ? xs.map((x) => ({ code: x.code, name: x.name, status: statusOf(x) })) : [{ code: g.label, name: "", status: "" }];
    const note = reasons(xs);
    groups[g.key] = { ...summarise(items, note), items, note };
  }
  const f = ((fuel ?? []) as { code: string; name: string; unit: string | null; used: number | null }[]).filter((x) => /GAS|DH|GH/.test(x.code) && x.used !== null);
  const pids = (params ?? []).map((p) => p.id);
  const latest = new Map<string, number>();
  if (pids.length) {
    const { data: r } = await supabase.from("readings").select("value_num, parameter:parameters(name)").in("parameter_id", pids)
      .is("voided_at", null).order("reading_for", { ascending: false }).limit(50);
    for (const x of (r ?? []) as unknown as { value_num: number | null; parameter: { name: string } | null }[]) {
      const k = x.parameter?.name ?? "";
      if (x.value_num !== null && !latest.has(k)) latest.set(k, x.value_num);
    }
  }
  // raw / treated water pumps are entered as "number running", so they are not in the tick list
  const wtpAssets = assets.filter((x) => ["Water Treatment", "Filtration", "UV Systems", "Pumps"].includes(x.category?.name ?? "") && !["PMP-RW", "PMP-TW"].includes(x.code));
  const wtpItems = wtpAssets.map((x) => ({ code: x.code, name: x.name, status: statusOf(x) }));
  const wtpNote = reasons(wtpAssets);
  const phRaw = latest.get("Raw Water pH");
  const phTreated = latest.get("Treated Water pH") ?? latest.get("pH");
  const sum = summarise(wtpItems, wtpNote);
  return {
    groups,
    fuel: f.map((x) => `${x.name}: ${Math.round(Number(x.used)).toLocaleString()} ${x.unit ?? ""}`).join("; "),
    wtp: {
      raw_running: "", treated_running: "", standby: sum.standby, ph: "",
      raw_count: "", treated_count: "",
      ph_raw: phRaw != null ? String(phRaw) : "", ph_treated: phTreated != null ? String(phTreated) : "",
      raw_level: latest.has("Raw Water Tank Level") ? String(latest.get("Raw Water Tank Level")) : "",
      treated_level: latest.has("Process Water Tank Level") ? String(latest.get("Process Water Tank Level")) : "",
      faults: sum.faults, items: wtpItems, note: wtpNote,
    },
    caustic: "",
  };
}
