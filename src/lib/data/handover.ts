import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/time";
import { HANDOVER_GROUPS, type GroupStatus, type HandoverContent } from "@/lib/handover";

export { HANDOVER_GROUPS, type GroupStatus, type HandoverContent };

interface Asset { code: string; name: string; area: string | null; op_state: string; op_reason: string | null; category: { name: string } | null }

/** Pre-fills a handover from the app: equipment states, the 07:00 fuel readings and the latest WTP readings. */
export async function prefillHandover(areas: string[], shiftDate: string, shift: "day" | "night"): Promise<Omit<HandoverContent, "checklist">> {
  const supabase = await createClient();
  const [{ data: a }, { data: fuel }, { data: params }] = await Promise.all([
    supabase.from("assets").select("code, name, area, op_state, op_reason, category:asset_categories(name)").neq("status", "retired").order("code"),
    supabase.from("meter_usage").select("code, name, unit, used").eq("grp", "daily").eq("read_date", shift === "day" ? shiftDate : addDays(shiftDate, 1)),
    supabase.from("parameters").select("id, name, unit").in("name", ["Raw Water Tank Level", "Process Water Tank Level", "pH", "Treated Water pH", "Raw Water pH"]),
  ]);
  const assets = ((a ?? []) as unknown as Asset[]).filter((x) => !x.area || areas.includes(x.area));
  const list = (xs: Asset[]) => xs.map((x) => x.code + (x.op_reason ? ` (${x.op_reason})` : "")).join(", ");
  const groups: Record<string, GroupStatus> = {};
  for (const g of HANDOVER_GROUPS) {
    const xs = assets.filter((x) => g.cats.includes(x.category?.name ?? "") && (!g.nameHas || x.name.includes(g.nameHas)));
    groups[g.key] = {
      running: list(xs.filter((x) => x.op_state === "available")),
      standby: list(xs.filter((x) => x.op_state === "standby")),
      faults: list(xs.filter((x) => x.op_state === "unavailable")),
    };
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
  const wtpAssets = assets.filter((x) => ["Water Treatment", "Filtration", "UV Systems", "Pumps"].includes(x.category?.name ?? ""));
  const pump = (code: string) => {
    const p = assets.find((x) => x.code === code);
    return p ? (p.op_state === "available" ? "Yes" : `${p.op_state}${p.op_reason ? ` (${p.op_reason})` : ""}`) : "";
  };
  const ph = latest.get("pH") ?? latest.get("Treated Water pH") ?? latest.get("Raw Water pH");
  return {
    groups,
    fuel: f.map((x) => `${x.name}: ${Math.round(Number(x.used)).toLocaleString()} ${x.unit ?? ""}`).join("; "),
    wtp: {
      raw_running: pump("PMP-RW"), treated_running: pump("PMP-TW"),
      standby: list(wtpAssets.filter((x) => x.op_state === "standby")),
      ph: ph != null ? String(ph) : "",
      raw_level: latest.has("Raw Water Tank Level") ? `${latest.get("Raw Water Tank Level")} %` : "",
      treated_level: latest.has("Process Water Tank Level") ? `${latest.get("Process Water Tank Level")} %` : "",
      faults: list(wtpAssets.filter((x) => x.op_state === "unavailable")),
    },
    caustic: "",
  };
}
