import { describe, expect, it } from "vitest";
import { calibrationState, waterStatus } from "./water";

describe("water result status (matches the SQL rule)", () => {
  const totalCount = { spec_min: null, spec_max: 100, max_inclusive: false, alert_max: 70 };
  it("Total count: spec < 100 cfu/100 ml, alert < 70", () => {
    expect(waterStatus(totalCount, 20)).toBe("ok");
    expect(waterStatus(totalCount, 70)).toBe("alert");
    expect(waterStatus(totalCount, 100)).toBe("action");
  });
  it("boiler feed water pH 8.5–9.5", () => {
    const ph = { spec_min: 8.5, spec_max: 9.5, max_inclusive: true, alert_max: null };
    expect(waterStatus(ph, 9.5)).toBe("ok");
    expect(waterStatus(ph, 8.4)).toBe("action");
  });
  it("no limit → recorded only", () => {
    expect(waterStatus({ spec_min: null, spec_max: null, max_inclusive: true, alert_max: null }, 12)).toBe("info");
  });
});

describe("calibration state", () => {
  it("overdue / due soon / ok", () => {
    expect(calibrationState("2026-10-01", "2026-10-12")).toBe("overdue");
    expect(calibrationState("2026-11-05", "2026-10-12")).toBe("due_soon");
    expect(calibrationState("2027-03-01", "2026-10-12")).toBe("ok");
    expect(calibrationState(null, "2026-10-12")).toBe("unknown");
  });
});
