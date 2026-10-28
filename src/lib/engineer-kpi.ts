/**
 * Individual Engineer KPI scorecard (FY tracker). Every KPI is a ratio num ÷ den.
 * Month, quarter and year values are computed from the summed numerators and denominators
 * (not an average of weekly percentages), so a quiet week does not weigh as much as a busy one.
 */
export interface Part { month: number; kpi: string; num: number; den: number }

export interface WeeklyLog {
  week_start: string;
  gemba_raised: number | null; gemba_closed: number | null;
  unsafe_observed: number | null; unsafe_reported: number | null;
  non_routine_jobs: number | null; permits_issued: number | null;
  thermax_callouts: number | null; thermax_acted: number | null;
}

/** Weekly-log KPIs (safety, THERMAX), attributed to the month the week starts in (as the Weekly Log sheet). Leakage comes from the registers. */
export function weeklyParts(logs: WeeklyLog[]): Part[] {
  const out: Part[] = [];
  const add = (month: number, kpi: string, num: number | null, den: number | null) => {
    if (den !== null && den > 0) out.push({ month, kpi, num: Math.min(num ?? 0, den), den });
  };
  for (const w of logs) {
    const m = Number(w.week_start.slice(5, 7));
    add(m, "gemba", w.gemba_closed, w.gemba_raised);
    add(m, "unsafe_act", w.unsafe_reported, w.unsafe_observed);
    add(m, "permit", w.permits_issued, w.non_routine_jobs);
    add(m, "thermax", w.thermax_acted, w.thermax_callouts);
  }
  return out;
}

export function pct(num: number, den: number): number | null {
  return den > 0 ? Math.round((num / den) * 1000) / 10 : null;
}

/** value per KPI for the given months (1–12), or null when there is no data. */
export function ratioFor(parts: Part[], kpi: string, months: number[]): number | null {
  let n = 0, d = 0;
  for (const p of parts) if (p.kpi === kpi && months.includes(p.month)) { n += p.num; d += p.den; }
  return pct(n, d);
}

export const QUARTERS: [string, number[]][] = [["Q1", [1, 2, 3]], ["Q2", [4, 5, 6]], ["Q3", [7, 8, 9]], ["Q4", [10, 11, 12]]];

export function status(value: number | null, targetMin: number): "pass" | "fail" | "none" {
  if (value === null) return "none";
  return value >= targetMin ? "pass" : "fail";
}
