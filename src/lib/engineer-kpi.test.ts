import { describe, expect, it } from "vitest";
import { ratioFor, status, weeklyParts } from "./engineer-kpi";

const empty = { gemba_raised: null, gemba_closed: null, unsafe_observed: null, unsafe_reported: null, non_routine_jobs: null,
  permits_issued: null, leaks_identified: null, leaks_closed_24h: null, thermax_callouts: null, thermax_acted: null };

describe("engineer KPI scorecard", () => {
  it("uses summed counts, not an average of weekly % (worked example)", () => {
    // week 1: 1 of 2 closed (50%); week 2: 18 of 18 closed (100%). Average of % = 75%, but 19 of 20 = 95%.
    const parts = weeklyParts([
      { ...empty, week_start: "2026-03-02", gemba_raised: 2, gemba_closed: 1 },
      { ...empty, week_start: "2026-03-09", gemba_raised: 18, gemba_closed: 18 },
    ]);
    expect(ratioFor(parts, "gemba", [3])).toBe(95);
    expect(status(95, 90)).toBe("pass");
  });
  it("quarter combines months", () => {
    const parts = [{ month: 1, kpi: "pm", num: 80, den: 100 }, { month: 2, kpi: "pm", num: 90, den: 100 }, { month: 3, kpi: "pm", num: 100, den: 100 }];
    expect(ratioFor(parts, "pm", [1, 2, 3])).toBe(90);
    expect(status(84.9, 85)).toBe("fail");
  });
  it("no data is neither pass nor fail", () => {
    expect(ratioFor([], "pm", [1])).toBeNull();
    expect(status(null, 85)).toBe("none");
  });
  it("weeks with nothing to count are ignored; numerator never exceeds denominator", () => {
    const parts = weeklyParts([{ ...empty, week_start: "2026-04-06", thermax_callouts: 0, thermax_acted: 0, permits_issued: 5, non_routine_jobs: 4 }]);
    expect(parts.find((p) => p.kpi === "thermax")).toBeUndefined();
    expect(ratioFor(parts, "permit", [4])).toBe(100);
  });
});
