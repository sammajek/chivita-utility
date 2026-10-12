export type WaterStatus = "ok" | "alert" | "action" | "info";

export interface WaterLimits {
  spec_min: number | null;
  spec_max: number | null;
  max_inclusive: boolean;
  alert_max: number | null;
}

/**
 * Same rule as public.water_status:
 * outside the specification → action; inside but at/above the alert limit → alert; otherwise ok.
 * "< 100 cfu" (max_inclusive = false) means 100 itself is out of spec.
 */
export function waterStatus(t: WaterLimits, v: number | null): WaterStatus {
  if (v === null || Number.isNaN(v)) return "info";
  if (t.spec_min !== null && v < t.spec_min) return "action";
  if (t.spec_max !== null && (v > t.spec_max || (!t.max_inclusive && v >= t.spec_max))) return "action";
  if (t.alert_max !== null && v >= t.alert_max) return "alert";
  if (t.spec_min === null && t.spec_max === null) return "info";
  return "ok";
}

export const WATER_LABEL: Record<WaterStatus, string> = {
  ok: "In spec",
  alert: "Alert",
  action: "Out of spec",
  info: "Recorded",
};

export const WATER_STYLE: Record<WaterStatus, string> = {
  ok: "bg-green-100 text-ok",
  alert: "bg-amber-100 text-warn",
  action: "bg-red-100 text-crit",
  info: "bg-gray-100 text-gray-600",
};

export type CalState = "overdue" | "due_soon" | "ok" | "unknown";

/** Calibration state from the next due date (YYYY-MM-DD). */
export function calibrationState(nextDue: string | null, today: string, warnDays = 30): CalState {
  if (!nextDue) return "unknown";
  if (nextDue < today) return "overdue";
  const warn = new Date(`${today}T00:00:00Z`);
  warn.setUTCDate(warn.getUTCDate() + warnDays);
  return nextDue <= warn.toISOString().slice(0, 10) ? "due_soon" : "ok";
}
