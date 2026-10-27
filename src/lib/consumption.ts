/** Helpers for the consumption report (daily use per meter and monthly totals). */

export interface UsageRow {
  meter_id: string; kind: string; read_date: string; value: number | string; used: number | string | null;
  is_reset: boolean; comment: string | null;
}

/** All dates (YYYY-MM-DD) of a month "YYYY-MM". */
export function monthDays(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
}

/**
 * Per meter: what to show on each reading date and the month figure.
 * Totalisers/hour counters: the use since the previous reading; the month total is the sum of uses
 * (a reading after a missed day carries both days, so the total stays right; a first-ever reading has no use).
 * Rate meters: the value read, and the average for the month.
 */
export function dailyUseByMeter(rows: UsageRow[]) {
  const out = new Map<string, { total: number; avg: number | null; byDay: Map<string, { v: number | null; reset: boolean; comment: string | null }> }>();
  const rate = new Map<string, number[]>();
  for (const r of rows) {
    let e = out.get(r.meter_id);
    if (!e) out.set(r.meter_id, (e = { total: 0, avg: null, byDay: new Map() }));
    if (r.kind === "rate") {
      const v = Number(r.value);
      e.byDay.set(r.read_date, { v, reset: false, comment: r.comment });
      rate.set(r.meter_id, [...(rate.get(r.meter_id) ?? []), v]);
    } else {
      const used = r.used === null ? null : Number(r.used);
      if (used !== null) e.total += used;
      e.byDay.set(r.read_date, { v: used, reset: r.is_reset, comment: r.comment });
    }
  }
  for (const [id, vs] of rate) out.get(id)!.avg = vs.reduce((a, b) => a + b, 0) / vs.length;
  return out;
}
