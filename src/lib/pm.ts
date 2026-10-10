import { addDays } from "@/lib/time";

export const PM_FREQUENCIES = ["daily", "weekly", "monthly", "quarterly", "bi_annual", "annual"] as const;
export type PmFrequency = (typeof PM_FREQUENCIES)[number];
export type PmResult = "done_ok" | "not_done" | "done_not_ok";

export const FREQ_LABEL: Record<PmFrequency, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  bi_annual: "Bi-annual",
  annual: "Annual",
};

/** Paper-log codes: Done OK "√", Not Done "--", Done Not OK "X". */
export const RESULT_LABEL: Record<PmResult, { code: string; text: string }> = {
  done_ok: { code: "√", text: "Done OK" },
  not_done: { code: "--", text: "Not done" },
  done_not_ok: { code: "X", text: "Done, not OK" },
};

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** First day of the PM period containing `date` (YYYY-MM-DD). Weeks start Sunday. Mirrors public.pm_period_start. */
export function pmPeriodStart(freq: PmFrequency, date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  switch (freq) {
    case "daily":
      return date;
    case "weekly": {
      const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
      return addDays(date, -dow);
    }
    case "monthly":
      return ymd(y, m, 1);
    case "quarterly":
      return ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1);
    case "bi_annual":
      return ymd(y, m <= 6 ? 1 : 7, 1);
    case "annual":
      return ymd(y, 1, 1);
  }
}

/** First day after the period (exclusive). Mirrors public.pm_period_end. */
export function pmPeriodEnd(freq: PmFrequency, start: string): string {
  const [y, m] = start.split("-").map(Number);
  const months = { monthly: 1, quarterly: 3, bi_annual: 6, annual: 12 } as const;
  if (freq === "daily") return addDays(start, 1);
  if (freq === "weekly") return addDays(start, 7);
  const total = m - 1 + months[freq];
  return ymd(y + Math.floor(total / 12), (total % 12) + 1, 1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export function pmPeriodLabel(freq: PmFrequency, start: string): string {
  const [y, m] = start.split("-").map(Number);
  switch (freq) {
    case "daily":
      return fmt(start);
    case "weekly":
      return `Week of ${fmt(start)} – ${fmt(addDays(start, 6))}`;
    case "monthly":
      return `${MONTHS[m - 1]} ${y}`;
    case "quarterly":
      return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
    case "bi_annual":
      return `${m === 1 ? "H1" : "H2"} ${y}`;
    case "annual":
      return String(y);
  }
}

/** Period starts that ended inside [from, to] (both YYYY-MM-DD; `to` exclusive of unfinished periods). */
export function completedPeriods(freq: PmFrequency, from: string, to: string): string[] {
  const out: string[] = [];
  let p = pmPeriodStart(freq, from);
  while (pmPeriodEnd(freq, p) <= to) {
    if (p >= from || freq !== "daily") out.push(p);
    p = pmPeriodEnd(freq, p);
  }
  return out;
}

/**
 * PM adherence = PMs carried out (Done OK + Done Not OK) ÷ PMs due, for periods that have ended.
 * "Not done" and blanks count as missed.
 */
export function pmAdherence(due: number, carriedOut: number): number | null {
  return due > 0 ? Math.round((carriedOut / due) * 1000) / 10 : null;
}
