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

/** When a slot opens for entry. Mirrors public.slot_opens. Entries before this are flagged as early. */
export function slotOpens(kind: SlotKind, logDate: string, slot: string, earlyMin = 15): Date {
  if (kind === "time") return new Date(slotDue(kind, logDate, slot).getTime() - earlyMin * 60_000);
  if (kind === "shift") return slot === "day" ? lagosInstant(logDate, 7) : lagosInstant(logDate, 19);
  return lagosInstant(logDate, 7);
}

export type SlotState = "done" | "open" | "due" | "missing" | "upcoming";

/**
 * upcoming: not open yet (entering now = early entry) · open: open, before its time · due: past its time,
 * within the grace period · missing: grace period over with nothing recorded · done: recorded.
 */
export function slotState(kind: SlotKind, logDate: string, slot: string, filled: boolean, now = new Date(),
                          earlyMin = 15, missingAfterMin = 60): SlotState {
  if (filled) return "done";
  const t = now.getTime();
  if (t < slotOpens(kind, logDate, slot, earlyMin).getTime()) return "upcoming";
  const due = slotDue(kind, logDate, slot).getTime();
  if (t < due) return "open";
  return t < due + missingAfterMin * 60_000 ? "due" : "missing";
}

/** The slot an operator most likely wants now: the latest slot already due (or the first one). */
export function defaultSlot(kind: SlotKind, times: string[] | null, logDate: string, now = new Date()): string {
  const keys = slotKeys(kind, times);
  if (kind === "shift") {
    const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }).format(now));
    return h >= 7 && h < 19 ? "day" : "night";
  }
  if (kind !== "time") return keys[0];
  // the latest slot that is already open for entry (opens 15 min before its time)
  let best = keys[0];
  for (const k of keys) {
    if (slotOpens(kind, logDate, k).getTime() <= now.getTime()) best = k;
  }
  return best;
}
