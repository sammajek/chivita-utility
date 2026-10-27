import { describe, expect, it } from "vitest";
import { dailyUseByMeter, monthDays } from "./consumption";

describe("monthDays", () => {
  it("lists every day of the month", () => {
    expect(monthDays("2026-02")).toHaveLength(28);
    expect(monthDays("2026-10")[30]).toBe("2026-10-31");
  });
});

describe("dailyUseByMeter", () => {
  it("totals daily use (worked example: 1000 → 1450 → 2350 m³ = 1350 m³)", () => {
    const m = dailyUseByMeter([
      { meter_id: "g", kind: "totaliser", read_date: "2026-10-01", value: 1000, used: null, is_reset: false, comment: null },
      { meter_id: "g", kind: "totaliser", read_date: "2026-10-02", value: 1450, used: 450, is_reset: false, comment: null },
      { meter_id: "g", kind: "totaliser", read_date: "2026-10-04", value: 2350, used: 900, is_reset: false, comment: "missed 3rd" },
    ]).get("g")!;
    expect(m.total).toBe(1350);
    expect(m.byDay.get("2026-10-04")?.v).toBe(900);
  });
  it("rate meters keep the value read and an average", () => {
    const m = dailyUseByMeter([
      { meter_id: "r", kind: "rate", read_date: "2026-10-01", value: 2400, used: null, is_reset: false, comment: null },
      { meter_id: "r", kind: "rate", read_date: "2026-10-02", value: 2600, used: null, is_reset: false, comment: null },
    ]).get("r")!;
    expect(m.avg).toBe(2500);
    expect(m.byDay.get("2026-10-02")?.v).toBe(2600);
  });
});
