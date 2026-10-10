import type { SlotKind } from "@/lib/types";
import { addDays, lagosDate, lagosInstant } from "@/lib/time";

/** Register "log date": a day runs 07:00 → 07:00 (Lagos). Mirrors public.log_date_of. */
export function logDateOf(at: Date): string {
  return lagosDate(new Date(at.getTime() - 7 * 3_600_000));
}

export function slotKeys(kind: SlotKind, times: string[] | null): string[] {
  switch (kind) {
    case "time":
      return (times ?? []).map((t) => t.slice(0, 5));
    case "shift":
      return ["day", "night"];
    case "daily_high_low":
      return ["high", "low"];
    default:
      return ["day"];
  }
}

/** When a slot is due. Mirrors public.slot_due. */
export function slotDue(kind: SlotKind, logDate: string, slot: string): Date {
  if (kind === "time") {
    const [h, m] = slot.split(":").map(Number);
    return lagosInstant(h < 7 ? addDays(logDate, 1) : logDate, h, m);
  }
  if (kind === "shift") return slot === "day" ? lagosInstant(logDate, 19) : lagosInstant(addDays(logDate, 1), 7);
  return lagosInstant(addDays(logDate, 1), 7);
}

export const SLOT_LABEL: Record<string, string> = {
  day: "Day shift",
  night: "Night shift",
  high: "Day high",
  low: "Day low",
};

export function slotLabel(kind: SlotKind, slot: string): string {
  if (kind === "daily") return "Daily";
  return SLOT_LABEL[slot] ?? slot;
}

/** The slot an operator most likely wants now: the latest slot already due (or the first one). */
export function defaultSlot(kind: SlotKind, times: string[] | null, logDate: string, now = new Date()): string {
  const keys = slotKeys(kind, times);
  if (kind === "shift") {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }).format(now));
    return h >= 7 && h < 19 ? "day" : "night";
  }
  if (kind !== "time") return keys[0];
  let best = keys[0];
  for (const k of keys) {
    if (slotDue(kind, logDate, k).getTime() <= now.getTime() + 15 * 60_000) best = k;
  }
  return best;
}
