import { describe, expect, it } from "vitest";
import { defaultSlot, logDateOf, slotDue, slotKeys, slotOpens, slotState } from "./registers";
import { lagosInstant } from "./time";

describe("register slots", () => {
  it("log date runs 07:00 to 07:00", () => {
    expect(logDateOf(lagosInstant("2026-10-10", 3))).toBe("2026-10-09");
    expect(logDateOf(lagosInstant("2026-10-10", 7))).toBe("2026-10-10");
  });
  it("03:00 slot is due the next calendar day", () => {
    expect(slotDue("time", "2026-10-09", "03:00").toISOString()).toBe("2026-10-10T02:00:00.000Z");
    expect(slotDue("time", "2026-10-09", "09:00").toISOString()).toBe("2026-10-09T08:00:00.000Z");
  });
  it("shift slots are due at shift end", () => {
    expect(slotDue("shift", "2026-10-09", "day").toISOString()).toBe("2026-10-09T18:00:00.000Z");
    expect(slotDue("shift", "2026-10-09", "night").toISOString()).toBe("2026-10-10T06:00:00.000Z");
  });
  it("keys per kind", () => {
    expect(slotKeys("time", ["09:00:00", "15:00:00"])).toEqual(["09:00", "15:00"]);
    expect(slotKeys("daily_high_low", null)).toEqual(["high", "low"]);
  });
  it("default slot is the latest one due", () => {
    const t = ["09:00", "15:00", "21:00", "03:00"];
    expect(defaultSlot("time", t, "2026-10-09", lagosInstant("2026-10-09", 16))).toBe("15:00");
    expect(defaultSlot("time", t, "2026-10-09", lagosInstant("2026-10-10", 4))).toBe("03:00");
    expect(defaultSlot("shift", null, "2026-10-09", lagosInstant("2026-10-09", 20))).toBe("night");
  });
});

describe("slot timing (owner rule: open 15 min before, missing 60 min after)", () => {
  // 15:00 slot on 10 Oct (Lagos, UTC+1) = 14:00Z
  const at = (iso: string) => new Date(iso);
  it("opens 15 minutes before the slot time", () => {
    expect(slotOpens("time", "2026-10-10", "15:00").toISOString()).toBe("2026-10-10T13:45:00.000Z");
    expect(slotOpens("shift", "2026-10-10", "night").toISOString()).toBe("2026-10-10T18:00:00.000Z");
  });
  it("states through the slot's life", () => {
    expect(slotState("time", "2026-10-10", "15:00", false, at("2026-10-10T13:30:00Z"))).toBe("upcoming");
    expect(slotState("time", "2026-10-10", "15:00", false, at("2026-10-10T13:50:00Z"))).toBe("open");
    expect(slotState("time", "2026-10-10", "15:00", false, at("2026-10-10T14:40:00Z"))).toBe("due");
    expect(slotState("time", "2026-10-10", "15:00", false, at("2026-10-10T15:01:00Z"))).toBe("missing");
    expect(slotState("time", "2026-10-10", "15:00", true, at("2026-10-10T15:01:00Z"))).toBe("done");
  });
});
