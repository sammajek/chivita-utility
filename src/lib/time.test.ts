import { describe, expect, it } from "vitest";
import { addDays, lagosDate, lagosInstant, shiftAt, shiftWindow } from "./time";

describe("Lagos time", () => {
  it("converts Lagos wall clock to UTC (UTC+1)", () => {
    expect(lagosInstant("2026-10-09", 7).toISOString()).toBe("2026-10-09T06:00:00.000Z");
  });

  it("gives the Lagos date for late-evening UTC instants", () => {
    // 23:30 UTC on 9 Oct is 00:30 on 10 Oct in Lagos
    expect(lagosDate(new Date("2026-10-09T23:30:00Z"))).toBe("2026-10-10");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("shifts", () => {
  it("07:00 starts the day shift", () => {
    const w = shiftAt(lagosInstant("2026-10-09", 7, 0));
    expect(w.shift).toBe("day");
    expect(w.shiftDate).toBe("2026-10-09");
  });

  it("18:59 is still the day shift, 19:00 is night", () => {
    expect(shiftAt(lagosInstant("2026-10-09", 18, 59)).shift).toBe("day");
    expect(shiftAt(lagosInstant("2026-10-09", 19, 0)).shift).toBe("night");
  });

  it("03:00 belongs to the night shift that started the previous evening", () => {
    const w = shiftAt(lagosInstant("2026-10-10", 3, 0));
    expect(w.shift).toBe("night");
    expect(w.shiftDate).toBe("2026-10-09");
    expect(w.start.toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-10-10T06:00:00.000Z");
  });

  it("a shift window is 12 hours", () => {
    const w = shiftWindow("day", "2026-10-09");
    expect(w.end.getTime() - w.start.getTime()).toBe(12 * 3_600_000);
  });
});
