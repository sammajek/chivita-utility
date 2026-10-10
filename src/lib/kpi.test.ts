import { describe, expect, it } from "vitest";
import { assetKpis, availability, hoursInPeriod, mtbf, mttr, operatingHoursFromCounter, type DowntimeEvent } from "./kpi";
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
  it("Availability = (720 − 12) ÷ 720 = 98.3 % (planned maintenance not counted)", () => {
    expect(k.planned_hours).toBeCloseTo(6);
    expect(k.availability).toBeCloseTo(708 / 720);
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
