import { describe, expect, it } from "vitest";
import { completedPeriods, pmAdherence, pmPeriodEnd, pmPeriodLabel, pmPeriodStart } from "./pm";

describe("PM periods (match the SQL functions)", () => {
  it("weeks start on Sunday", () => {
    expect(pmPeriodStart("weekly", "2026-10-10")).toBe("2026-10-04"); // Saturday → previous Sunday
    expect(pmPeriodStart("weekly", "2026-10-04")).toBe("2026-10-04");
  });
  it("months, quarters, halves, years", () => {
    expect(pmPeriodStart("monthly", "2026-10-10")).toBe("2026-10-01");
    expect(pmPeriodStart("quarterly", "2026-11-20")).toBe("2026-10-01");
    expect(pmPeriodStart("bi_annual", "2026-10-10")).toBe("2026-07-01");
    expect(pmPeriodStart("annual", "2026-10-10")).toBe("2026-01-01");
  });
  it("period ends roll over the year", () => {
    expect(pmPeriodEnd("monthly", "2026-12-01")).toBe("2027-01-01");
    expect(pmPeriodEnd("quarterly", "2026-10-01")).toBe("2027-01-01");
    expect(pmPeriodEnd("bi_annual", "2026-07-01")).toBe("2027-01-01");
    expect(pmPeriodEnd("weekly", "2026-12-27")).toBe("2027-01-03");
  });
  it("labels", () => {
    expect(pmPeriodLabel("quarterly", "2026-10-01")).toBe("Q4 2026");
    expect(pmPeriodLabel("bi_annual", "2026-07-01")).toBe("H2 2026");
  });
});

describe("PM adherence worked example", () => {
  // One daily PM task over 1–30 Sep 2026: 30 periods due.
  // 26 Done OK + 1 Done Not OK = 27 carried out; 2 Not done + 1 blank = missed.
  it("27 of 30 = 90%", () => {
    expect(completedPeriods("daily", "2026-09-01", "2026-10-01")).toHaveLength(30);
    expect(pmAdherence(30, 27)).toBe(90);
  });
  it("weekly task: only weeks that ended count", () => {
    // Weeks starting Sun 30 Aug … Sun 27 Sep; the week of 27 Sep ends 4 Oct, after 1 Oct.
    expect(completedPeriods("weekly", "2026-09-01", "2026-10-01")).toEqual(["2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20"]);
  });
  it("no PM due → no figure", () => {
    expect(pmAdherence(0, 0)).toBeNull();
  });
});
