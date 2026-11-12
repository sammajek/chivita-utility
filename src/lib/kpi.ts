/**
 * Maintenance KPIs. Formulas are shown in the app next to each figure.
 *
 *  MTTR  = total unplanned breakdown hours ÷ number of unplanned breakdowns
 *  MTBF  = operating hours ÷ number of unplanned breakdowns (per equipment)
 *          Operating hours come from the running-hours counters logged on the
 *          registers. Where an asset has no counter, scheduled hours minus all
 *          downtime is used instead and the figure is marked "estimated".
 *          (Not total calendar equipment-hours across the fleet, which is what
 *          the Excel dashboard does and gives ~315,000 h.)
 *  Availability = (scheduled hours − planned downtime − availability loss) ÷ (scheduled hours − planned downtime)
 *          Scheduled hours = 24 h × days in the period (24/7 plant).
 *          Availability loss = unplanned breakdowns + condition-based stops that had to happen at once
 *          + time planned work ran over its planned duration. Planned work within its plan is taken out of
 *          scheduled time; external supply failures are shown separately and not charged to the machine.
 */

export interface DowntimeEvent {
  asset_id: string;
  downtime_type: string;
  start_at: string;
  end_at: string | null;
  override_hours: number | null;
  /** CBM only: the machine had to stop at once (counts as a loss) */
  immediate_stop?: boolean | null;
  /** planned work / scheduled CBM: planned duration; time beyond it counts as a loss */
  planned_hours?: number | null;
}

export const UNPLANNED = "Unplanned Breakdown";
export const CBM = "Condition-Based Maintenance (CBM)";
export const PLANNED = "Planned Maintenance";
export const EXTERNAL = "External Supply Failure";
const H = 3_600_000;

/** Hours of an event that fall inside [from, to). Override hours are pro-rated. */
export function hoursInPeriod(e: DowntimeEvent, from: Date, to: Date, now = new Date()): number {
  const s = new Date(e.start_at).getTime();
  const end = e.end_at ? new Date(e.end_at).getTime() : now.getTime();
  const lo = Math.max(s, from.getTime());
  const hi = Math.min(end, to.getTime());
  if (hi <= lo) return 0;
  const clipped = (hi - lo) / H;
  if (e.override_hours === null) return clipped;
  const full = (end - s) / H;
  return full > 0 ? (e.override_hours * clipped) / full : e.override_hours;
}

/** Splits an event's hours inside [from, to) into availability loss, planned downtime and external downtime. */
export function splitHours(e: DowntimeEvent, from: Date, to: Date, now = new Date()) {
  const h = hoursInPeriod(e, from, to, now);
  const out = { loss: 0, planned: 0, external: 0 };
  if (e.downtime_type === UNPLANNED || (e.downtime_type === CBM && e.immediate_stop)) out.loss = h;
  else if (e.downtime_type === PLANNED || e.downtime_type === CBM) {
    if (e.planned_hours == null) out.planned = h;
    else {
      const full = hoursInPeriod(e, new Date(0), new Date(8.64e15), now);
      const share = full > 0 ? Math.min(1, e.planned_hours / full) : 1;
      out.planned = h * share;
      out.loss = h - out.planned;
    }
  } else if (e.downtime_type === EXTERNAL) out.external = h;
  return out;
}

export function mttr(events: DowntimeEvent[], from: Date, to: Date, now = new Date()): number | null {
  const unplanned = events.filter((e) => e.downtime_type === UNPLANNED && new Date(e.start_at) >= from && new Date(e.start_at) < to);
  if (unplanned.length === 0) return null;
  const hrs = unplanned.reduce((t, e) => t + hoursInPeriod(e, new Date(0), new Date(8.64e15), now), 0);
  return hrs / unplanned.length;
}

export function mtbf(operatingHours: number, failures: number): number | null {
  if (failures <= 0) return null;
  return operatingHours / failures;
}

/** Availability = (scheduled − planned − loss) ÷ (scheduled − planned). */
export function availability(scheduledHours: number, lossHours: number, plannedHours = 0): number | null {
  const base = scheduledHours - plannedHours;
  if (base <= 0) return null;
  return Math.max(0, (base - lossHours) / base);
}

/** Running hours from cumulative counter readings: sum of positive increases (counter resets ignored). */
export function operatingHoursFromCounter(values: { at: string; value: number }[]): number | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a.at.localeCompare(b.at));
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i].value - sorted[i - 1].value;
    if (d > 0) total += d;
  }
  return total;
}

export interface AssetKpi {
  asset_id: string;
  failures: number;
  /** availability loss hours (breakdowns, urgent CBM, planned overruns) */
  unplanned_hours: number;
  planned_hours: number;
  external_hours: number;
  operating_hours: number;
  operating_hours_estimated: boolean;
  mttr: number | null;
  mtbf: number | null;
  availability: number | null;
}

export function assetKpis(
  assetIds: string[],
  events: DowntimeEvent[],
  counters: Map<string, { at: string; value: number }[]>,
  from: Date,
  to: Date,
  now = new Date(),
): AssetKpi[] {
  const scheduled = Math.max(0, (Math.min(to.getTime(), now.getTime()) - from.getTime()) / H);
  return assetIds.map((id) => {
    const evs = events.filter((e) => e.asset_id === id);
    const unplannedEvs = evs.filter((e) => e.downtime_type === UNPLANNED);
    const failures = unplannedEvs.filter((e) => new Date(e.start_at) >= from && new Date(e.start_at) < to).length;
    const parts = evs.map((e) => splitHours(e, from, to, now));
    const unplanned = parts.reduce((t, p) => t + p.loss, 0);
    const planned = parts.reduce((t, p) => t + p.planned, 0);
    const external = parts.reduce((t, p) => t + p.external, 0);
    const counted = operatingHoursFromCounter(counters.get(id) ?? []);
    const operating = counted ?? Math.max(0, scheduled - unplanned - planned - external);
    return {
      asset_id: id,
      failures,
      unplanned_hours: unplanned,
      planned_hours: planned,
      external_hours: external,
      operating_hours: operating,
      operating_hours_estimated: counted === null,
      mttr: failures ? unplannedEvs.filter((e) => new Date(e.start_at) >= from && new Date(e.start_at) < to)
        .reduce((t, e) => t + hoursInPeriod(e, new Date(0), new Date(8.64e15), now), 0) / failures : null,
      mtbf: mtbf(operating, failures),
      availability: availability(scheduled, unplanned, planned),
    };
  });
}

/** Share of expected reading slots that were filled (on time = within lateMin). */
export function compliance(expected: number, filled: number, onTime: number) {
  return {
    filledPct: expected ? (filled / expected) * 100 : null,
    onTimePct: expected ? (onTime / expected) * 100 : null,
  };
}

/**
 * Utility OEE = Availability × Performance × Quality (confirmed by the section manager).
 * Performance = actual output ÷ (rated output per hour × operating hours), capped at 100 %.
 * Quality = readings in spec ÷ readings judged against a standard (info-only readings excluded).
 */
export function performance(actualOutput: number | null, ratedPerHour: number | null, operatingHours: number): number | null {
  if (actualOutput === null || !ratedPerHour || ratedPerHour <= 0 || operatingHours <= 0) return null;
  return Math.min(1, Math.max(0, actualOutput / (ratedPerHour * operatingHours)));
}

export function quality(inSpec: number, judged: number): number | null {
  return judged > 0 ? inSpec / judged : null;
}

export function oee(a: number | null, p: number | null, q: number | null): number | null {
  return a === null || p === null || q === null ? null : a * p * q;
}
