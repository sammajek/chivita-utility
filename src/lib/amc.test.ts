import { describe, expect, it } from "vitest";
import { amcCompletion, amcStatus, cleaningCompliance } from "./amc";

describe("AMC status", () => {
  const now = "2026-10-01";
  it("matches the sheet's Planned / Done / Past Due", () => {
    expect(amcStatus(true, true, "2026-09-01", now)).toBe("done");
    expect(amcStatus(true, false, "2026-09-01", now)).toBe("past_due");
    expect(amcStatus(true, false, "2026-10-01", now)).toBe("planned"); // current month not yet past due
    expect(amcStatus(false, true, "2026-08-01", now)).toBe("extra");
    expect(amcStatus(false, false, "2026-08-01", now)).toBeNull();
  });
  it("worked example: 9 planned months ended, 7 visits → 77.8%", () => {
    const cells = Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}-01`,
      planned: true,
      visited: i < 9 && i !== 2 && i !== 6, // Mar and Jul missed
    }));
    expect(amcCompletion(cells, "2026-10-01")).toEqual({ due: 9, done: 7, pct: 77.8 });
  });
});

describe("cleaning compliance", () => {
  it("5 zones × 3 activities × 4 weeks = 60 expected; 54 done = 90%", () => {
    expect(cleaningCompliance(60, 54)).toBe(90);
    expect(cleaningCompliance(0, 0)).toBeNull();
  });
});
