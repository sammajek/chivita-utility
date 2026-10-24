import { describe, expect, it } from "vitest";
import { serviceStatus } from "./hours";

describe("serviceStatus", () => {
  const i = { interval_hours: 2000, warn_before_hours: 200, last_service_hours: 2000 };
  it("needs a baseline first", () => {
    expect(serviceStatus({ ...i, last_service_hours: null }, 3000).state).toBe("no_baseline");
  });
  it("ok well before the due hours", () => {
    const s = serviceStatus(i, 3500);
    expect(s.state).toBe("ok");
    expect(s.dueAt).toBe(4000);
    expect(s.remaining).toBe(500);
  });
  it("due soon within the warning window (worked example: 3850 h, due 4000 h, warn 200 h)", () => {
    expect(serviceStatus(i, 3850).state).toBe("due_soon");
    expect(serviceStatus(i, 3800).state).toBe("due_soon");
  });
  it("overdue at or past the due hours", () => {
    expect(serviceStatus(i, 4000).state).toBe("overdue");
    expect(serviceStatus(i, 4120).remaining).toBe(-120);
  });
  it("no reading logged", () => {
    expect(serviceStatus(i, null).state).toBe("no_reading");
  });
});
