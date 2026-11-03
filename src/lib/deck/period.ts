import { addDays } from "@/lib/time";

export const PERIODS = {
  last_week: "Last week (Mon–Sun)",
  last_7_days: "Last 7 days",
  last_month: "Last calendar month",
  month_to_date: "Month to date",
  last_30_days: "Last 30 days",
} as const;
export type Period = keyof typeof PERIODS;

/** Inclusive from/to dates (YYYY-MM-DD) for a rolling period, relative to `today` (Lagos log date). */
export function periodDates(period: Period, today: string): { from: string; to: string } {
  const dow = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
  switch (period) {
    case "last_week": {
      const mon = addDays(today, -dow - 7);
      return { from: mon, to: addDays(mon, 6) };
    }
    case "last_month": {
      const end = addDays(`${today.slice(0, 7)}-01`, -1);
      return { from: `${end.slice(0, 7)}-01`, to: end };
    }
    case "month_to_date":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_30_days":
      return { from: addDays(today, -29), to: today };
    default:
      return { from: addDays(today, -6), to: today };
  }
}
