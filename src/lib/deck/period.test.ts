import { describe, expect, it } from "vitest";
import { periodDates } from "./period";

describe("periodDates (today = Tue 3 Nov 2026)", () => {
  const t = "2026-11-03";
  it("last week is the previous Monday–Sunday", () => expect(periodDates("last_week", t)).toEqual({ from: "2026-10-26", to: "2026-11-01" }));
  it("on a Monday, last week ends yesterday", () => expect(periodDates("last_week", "2026-11-02")).toEqual({ from: "2026-10-26", to: "2026-11-01" }));
  it("last month", () => expect(periodDates("last_month", t)).toEqual({ from: "2026-10-01", to: "2026-10-31" }));
  it("last month across the year end", () => expect(periodDates("last_month", "2027-01-05")).toEqual({ from: "2026-12-01", to: "2026-12-31" }));
  it("month to date", () => expect(periodDates("month_to_date", t)).toEqual({ from: "2026-11-01", to: t }));
  it("last 7 and 30 days include today", () => {
    expect(periodDates("last_7_days", t)).toEqual({ from: "2026-10-28", to: t });
    expect(periodDates("last_30_days", t).from).toBe("2026-10-05");
  });
});
