import { describe, expect, it } from "vitest";
import { parseLoggerCsv } from "./logger-csv";

describe("parseLoggerCsv", () => {
  it("reads asset readings and meter readings; local times are Lagos", () => {
    const { rows, errors } = parseLoggerCsv("timestamp;asset_code;parameter;meter_code;value\n2026-11-03 09:05;CMP-03;Running Hours;;4321\n2026-11-03 07:02:00;;;E-C3;120000");
    expect(errors).toEqual([]);
    expect(rows[0]).toEqual({ timestamp: "2026-11-03T09:05+01:00", value: "4321", asset_code: "CMP-03", parameter: "Running Hours" });
    expect(rows[1]).toEqual({ timestamp: "2026-11-03T07:02:00+01:00", value: "120000", meter_code: "E-C3" });
  });
  it("keeps explicit time zones and reports bad rows", () => {
    const { rows, errors } = parseLoggerCsv("timestamp,meter_code,value\n2026-11-03T06:02:00Z,E-C3,5\nyesterday,E-C3,6");
    expect(rows).toHaveLength(1);
    expect(rows[0].timestamp).toBe("2026-11-03T06:02:00Z");
    expect(errors[0]).toMatch(/Row 3/);
  });
  it("needs the right columns", () => {
    expect(parseLoggerCsv("time,value\n1,2").errors.length).toBeGreaterThan(0);
  });
});
