/**
 * In-spec check for live feedback on the entry form. Mirrors the database
 * function public.evaluate_value, which has the final say when a reading is saved.
 */
export type ReadingStatus = "ok" | "out_of_spec" | "critical" | "info";

export interface ParamSpec {
  data_type: "number" | "select" | "text";
  options: string[] | null;
  ok_options: string[] | null;
  std_min: number | null;
  std_max: number | null;
  crit_min: number | null;
  crit_max: number | null;
  is_counter: boolean;
}

export function evaluateValue(p: ParamSpec, num: number | null, text: string | null): ReadingStatus {
  if (p.is_counter) return "info";
  if (p.data_type === "number") {
    if (num === null || Number.isNaN(num)) return "info";
    if ((p.crit_min !== null && num < p.crit_min) || (p.crit_max !== null && num > p.crit_max)) return "critical";
    if (p.std_min === null && p.std_max === null) return "info";
    if ((p.std_min !== null && num < p.std_min) || (p.std_max !== null && num > p.std_max)) return "out_of_spec";
    return "ok";
  }
  if (p.data_type === "select") {
    if (!p.ok_options || p.ok_options.length === 0 || text === null) return "info";
    return p.ok_options.includes(text) ? "ok" : "out_of_spec";
  }
  return "info";
}

export function describeStandard(p: Pick<ParamSpec, "std_min" | "std_max" | "ok_options">, unit?: string | null): string {
  const u = unit ? ` ${unit}` : "";
  if (p.std_min !== null && p.std_max !== null) {
    return p.std_min === p.std_max ? `${p.std_min}${u}` : `${p.std_min}–${p.std_max}${u}`;
  }
  if (p.std_min !== null) return `≥ ${p.std_min}${u}`;
  if (p.std_max !== null) return `≤ ${p.std_max}${u}`;
  if (p.ok_options?.length) return p.ok_options.join(" / ");
  return "Record only";
}

export const STATUS_LABEL: Record<ReadingStatus, string> = {
  ok: "In spec",
  out_of_spec: "Out of spec",
  critical: "Critical",
  info: "Recorded",
};
