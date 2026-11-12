import { describe, expect, it } from "vitest";
import { nextShift, prevShift, summarise } from "./handover";

describe("handover helpers", () => {
  it("summarises ticked machines into the template's columns", () => {
    const s = summarise([
      { code: "CMP-03", name: "", status: "running" }, { code: "CMP-04", name: "", status: "running" },
      { code: "CMP-05", name: "", status: "standby" }, { code: "CMP-06", name: "", status: "fault" }, { code: "CMP-07", name: "", status: "" },
    ], "oil leak, vendor called");
    expect(s).toEqual({ running: "CMP-03, CMP-04", standby: "CMP-05", faults: "CMP-06 – oil leak, vendor called" });
  });
  it("finds the next and previous shift across midnight and month ends", () => {
    expect(nextShift({ shiftDate: "2026-11-30", shift: "day" })).toEqual({ shiftDate: "2026-11-30", shift: "night" });
    expect(nextShift({ shiftDate: "2026-11-30", shift: "night" })).toEqual({ shiftDate: "2026-12-01", shift: "day" });
    expect(prevShift({ shiftDate: "2026-12-01", shift: "day" })).toEqual({ shiftDate: "2026-11-30", shift: "night" });
  });
});
