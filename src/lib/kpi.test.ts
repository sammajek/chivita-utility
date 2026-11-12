import { describe, expect, it } from "vitest";
import { assetKpis, availability, splitHours, hoursInPeriod, mtbf, mttr, oee, operatingHoursFromCounter, performance, quality, type DowntimeEvent } from "./kpi";
import { describeStandard, evaluateValue, type ParamSpec } from "./evaluate";

const from = new Date("2026-09-01T00:00:00+01:00");
const to = new Date("2026-10-01T00:00:00+01:00"); // 30 days = 720 h
const now = new Date("2026-10-09T12:00:00+01:00");

const ev = (asset: string, start: string, end: string | null, type = "Unplanned Breakdown", override: number | null = null): DowntimeEvent => ({
  asset_id: asset, downtime_type: type, start_at: start, end_at: end, override_hours: override,
});

describe("worked example: Compressor 5 in September", () => {
  // Three breakdowns of 2 h, 3 h and 7 h; one planned 6 h service.
  const events = [
    ev("C5", "2026-09-03T10:00:00+01:00", "2026-09-03T12:00:00+01:00"),
    ev("C5", "2026-09-12T22:00:00+01:00", "2026-09-13T01:00:00+01:00"), // across midnight
    ev("C5", "2026-09-20T08:00:00+01:00", "2026-09-20T15:00:00+01:00"),
    ev("C5", "2026-09-25T07:00:00+01:00", "2026-09-25T13:00:00+01:00", "Planned Maintenance"),
  ];
  // Running-hours counter went from 5,000 to 5,650 h during the month.
  const counters = new Map([["C5", [{ at: "2026-09-01T09:00:00Z", value: 5000 }, { at: "2026-09-15T09:00:00Z", value: 5320 }, { at: "2026-09-30T21:00:00Z", value: 5650 }]]]);
  const [k] = assetKpis(["C5"], events, counters, from, to, now);

  it("MTTR = 12 h ÷ 3 = 4 h", () => {
    expect(k.failures).toBe(3);
    expect(k.unplanned_hours).toBeCloseTo(12);
    expect(k.mttr).toBeCloseTo(4);
  });
  it("MTBF = 650 operating hours ÷ 3 = 216.7 h (from the counter, not calendar hours)", () => {
    expect(k.operating_hours).toBe(650);
    expect(k.operating_hours_estimated).toBe(false);
    expect(k.mtbf).toBeCloseTo(216.67, 1);
  });
  it("Availability = (720 − 6 planned − 12 lost) ÷ (720 − 6) = 98.32 % (planned work taken out of scheduled time)", () => {
    expect(k.planned_hours).toBeCloseTo(6);
    expect(k.availability).toBeCloseTo(702 / 714, 6);
  });
});

describe("without a counter MTBF is estimated from scheduled hours", () => {
  it("(720 − 10 h down) ÷ 2 breakdowns = 355 h", () => {
    const events = [
      ev("B1", "2026-09-05T10:00:00+01:00", "2026-09-05T14:00:00+01:00"),
      ev("B1", "2026-09-15T10:00:00+01:00", "2026-09-15T16:00:00+01:00"),
    ];
    const [k] = assetKpis(["B1"], events, new Map(), from, to, now);
    expect(k.operating_hours_estimated).toBe(true);
    expect(k.mtbf).toBeCloseTo(355);
  });
});

describe("building blocks", () => {
  it("clips an event to the period", () => {
    const e = ev("X", "2026-08-31T20:00:00+01:00", "2026-09-01T04:00:00+01:00");
    expect(hoursInPeriod(e, from, to)).toBeCloseTo(4);
  });
  it("open events count up to now", () => {
    const e = ev("X", "2026-10-09T06:00:00+01:00", null);
    expect(hoursInPeriod(e, new Date("2026-10-09T00:00:00+01:00"), new Date("2026-10-10T00:00:00+01:00"), now)).toBeCloseTo(6);
  });
  it("override hours win and are pro-rated", () => {
    const e = ev("X", "2026-09-10T00:00:00+01:00", "2026-09-10T10:00:00+01:00", "Unplanned Breakdown", 5);
    expect(hoursInPeriod(e, from, to)).toBeCloseTo(5);
  });
  it("MTTR ignores planned work; null with no breakdowns", () => {
    expect(mttr([ev("X", "2026-09-10T00:00:00+01:00", "2026-09-10T06:00:00+01:00", "Planned Maintenance")], from, to)).toBeNull();
  });
  it("MTBF null with no failures; availability bounds", () => {
    expect(mtbf(100, 0)).toBeNull();
    expect(availability(720, 0)).toBe(1);
    expect(availability(0, 0)).toBeNull();
  });
  it("counter resets are ignored", () => {
    expect(operatingHoursFromCounter([{ at: "1", value: 100 }, { at: "2", value: 150 }, { at: "3", value: 10 }, { at: "4", value: 30 }])).toBe(70);
  });
});

describe("spec check matches the database rules", () => {
  const steam: ParamSpec = { data_type: "number", options: null, ok_options: null, std_min: 8, std_max: 8.5, crit_min: null, crit_max: null, is_counter: false };
  it("number ranges", () => {
    expect(evaluateValue(steam, 8.2, null)).toBe("ok");
    expect(evaluateValue(steam, 7.9, null)).toBe("out_of_spec");
    expect(evaluateValue({ ...steam, crit_min: 7 }, 6.5, null)).toBe("critical");
    expect(evaluateValue({ ...steam, is_counter: true }, 1, null)).toBe("info");
  });
  it("select checks", () => {
    const leak: ParamSpec = { ...steam, data_type: "select", options: ["No Leak", "Leak"], ok_options: ["No Leak"], std_min: null, std_max: null };
    expect(evaluateValue(leak, null, "No Leak")).toBe("ok");
    expect(evaluateValue(leak, null, "Leak")).toBe("out_of_spec");
  });
  it("describes standards", () => {
    expect(describeStandard(steam, "bar")).toBe("8–8.5 bar");
    expect(describeStandard({ std_min: 90, std_max: null, ok_options: null }, "%")).toBe("≥ 90 %");
  });
});

describe("worked example: Boiler 4 OEE over 30 days", () => {
  // 720 h scheduled, 36 h unplanned breakdowns → A = 684/720 = 95 %.
  // Rated 3.5 t/h, ran 600 h, made 1,680 t → P = 1680 / (3.5 × 600) = 80 %.
  // 1,000 readings checked against a standard, 980 in spec → Q = 98 %.
  // OEE = 0.95 × 0.80 × 0.98 = 74.48 %.
  it("multiplies the three factors", () => {
    const a = availability(720, 36)!;
    const p = performance(1680, 3.5, 600)!;
    const q = quality(980, 1000)!;
    expect(a).toBeCloseTo(0.95, 6);
    expect(p).toBeCloseTo(0.8, 6);
    expect(q).toBeCloseTo(0.98, 6);
    expect(oee(a, p, q)).toBeCloseTo(0.7448, 6);
  });
  it("is blank when a factor cannot be worked out", () => {
    expect(performance(1680, null, 600)).toBeNull();
    expect(performance(null, 3.5, 600)).toBeNull();
    expect(quality(0, 0)).toBeNull();
    expect(oee(0.95, null, 0.98)).toBeNull();
  });
  it("caps performance at 100 % (meter or rating error)", () => {
    expect(performance(3000, 3.5, 600)).toBe(1);
  });
});

describe("worked example: how each downtime type counts (one compressor, 30 days = 720 h)", () => {
  const evs: DowntimeEvent[] = [
    ev("C9", "2026-09-02T08:00:00+01:00", "2026-09-02T12:00:00+01:00"),                                  // 4 h breakdown → loss
    { ...ev("C9", "2026-09-05T07:00:00+01:00", "2026-09-05T15:00:00+01:00", "Planned Maintenance"), planned_hours: 6 }, // 8 h, planned 6 → 6 planned + 2 overrun loss
    { ...ev("C9", "2026-09-10T09:00:00+01:00", "2026-09-10T12:00:00+01:00", "Condition-Based Maintenance (CBM)"), immediate_stop: true }, // 3 h urgent CBM → loss
    ev("C9", "2026-09-12T09:00:00+01:00", "2026-09-12T11:00:00+01:00", "Condition-Based Maintenance (CBM)"),  // 2 h scheduled CBM → planned
    ev("C9", "2026-09-15T07:00:00+01:00", "2026-09-15T12:00:00+01:00", "External Supply Failure"),       // 5 h grid outage → external
    ev("C9", "2026-09-20T07:00:00+01:00", "2026-09-20T19:00:00+01:00", "Idle / Standby"),                // old idle event → ignored
  ];
  const [k] = assetKpis(["C9"], evs, new Map(), from, to, now);
  it("splits the hours", () => {
    expect(k.unplanned_hours).toBeCloseTo(4 + 2 + 3, 6);
    expect(k.planned_hours).toBeCloseTo(6 + 2, 6);
    expect(k.external_hours).toBeCloseTo(5, 6);
    expect(k.failures).toBe(1);
  });
  it("availability = (720 − 8) − 9 over (720 − 8) = 98.74 %", () => {
    expect(k.availability).toBeCloseTo((712 - 9) / 712, 6);
  });
  it("planned work without a planned duration is all planned", () => {
    expect(splitHours(ev("X", "2026-09-05T07:00:00+01:00", "2026-09-05T15:00:00+01:00", "Planned Maintenance"), from, to, now))
      .toEqual({ loss: 0, planned: 8, external: 0 });
  });
});
