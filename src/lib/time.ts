/**
 * Plant time helpers. The plant runs 24/7 in Africa/Lagos (UTC+1, no DST).
 * Shifts: Day 07:00–19:00, Night 19:00–07:00. A night shift belongs to the
 * date it started (Night of 9 Oct runs 9 Oct 19:00 → 10 Oct 07:00).
 */

export const PLANT_TZ = "Africa/Lagos";
const LAGOS_OFFSET_MIN = 60;
export const DAY_SHIFT_START_HOUR = 7;
export const NIGHT_SHIFT_START_HOUR = 19;

export type Shift = "day" | "night";

export const SHIFT_LABELS: Record<Shift, string> = {
  day: "Day Shift (7am - 7pm)",
  night: "Night Shift (7pm - 7am)",
};

/** Wall-clock parts of an instant in Lagos time. */
export function lagosParts(at: Date) {
  const t = new Date(at.getTime() + LAGOS_OFFSET_MIN * 60_000);
  return {
    year: t.getUTCFullYear(),
    month: t.getUTCMonth() + 1,
    day: t.getUTCDate(),
    hour: t.getUTCHours(),
    minute: t.getUTCMinutes(),
  };
}

/** The instant for a Lagos wall-clock date + time. `date` is YYYY-MM-DD. */
export function lagosInstant(date: string, hour = 0, minute = 0): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour, minute) - LAGOS_OFFSET_MIN * 60_000);
}

/** YYYY-MM-DD of an instant in Lagos time. */
export function lagosDate(at: Date): string {
  const p = lagosParts(at);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export function addDays(date: string, days: number): string {
  return lagosDate(new Date(lagosInstant(date, 12).getTime() + days * 86_400_000));
}

export interface ShiftWindow {
  shift: Shift;
  /** The date the shift started on (YYYY-MM-DD, Lagos). */
  shiftDate: string;
  start: Date;
  end: Date;
}

export function shiftWindow(shift: Shift, shiftDate: string): ShiftWindow {
  const startHour = shift === "day" ? DAY_SHIFT_START_HOUR : NIGHT_SHIFT_START_HOUR;
  const start = lagosInstant(shiftDate, startHour);
  return { shift, shiftDate, start, end: new Date(start.getTime() + 12 * 3_600_000) };
}

/** Which shift an instant falls in. */
export function shiftAt(at: Date): ShiftWindow {
  const { hour } = lagosParts(at);
  const today = lagosDate(at);
  if (hour >= DAY_SHIFT_START_HOUR && hour < NIGHT_SHIFT_START_HOUR) return shiftWindow("day", today);
  if (hour >= NIGHT_SHIFT_START_HOUR) return shiftWindow("night", today);
  return shiftWindow("night", addDays(today, -1));
}

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: PLANT_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** e.g. "09 Oct 2026, 14:05" in Lagos time. */
export function formatLagos(at: Date | string): string {
  return dateTimeFmt.format(typeof at === "string" ? new Date(at) : at);
}
