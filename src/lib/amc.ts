/** AMC month status, as on the Utility AMC sheet: Planned / Done / Past Due. */
export type AmcStatus = "done" | "planned" | "past_due" | "extra" | null;

/**
 * - done: planned and a visit was recorded
 * - extra: a visit was recorded in a month that was not planned
 * - past_due: planned, the month has ended and no visit was recorded
 * - planned: planned for the current or a future month
 */
export function amcStatus(planned: boolean, visited: boolean, month: string, thisMonth: string): AmcStatus {
  if (visited) return planned ? "done" : "extra";
  if (!planned) return null;
  return month < thisMonth ? "past_due" : "planned";
}

/** AMC completion % = planned visits done ÷ planned visits whose month has ended. */
export function amcCompletion(cells: { planned: boolean; visited: boolean; month: string }[], thisMonth: string) {
  const due = cells.filter((c) => c.planned && c.month < thisMonth);
  const done = due.filter((c) => c.visited).length;
  return { due: due.length, done, pct: due.length ? Math.round((done / due.length) * 1000) / 10 : null };
}

/** Cleaning compliance % = activities marked Done ÷ activities expected (zones × activities × weeks). */
export function cleaningCompliance(expected: number, done: number): number | null {
  return expected > 0 ? Math.round((done / expected) * 1000) / 10 : null;
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
