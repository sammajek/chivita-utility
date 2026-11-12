import { readFileSync } from "node:fs";
import type { DeckData } from "./data";
import { SECTION_KEYS } from "./sections";

export const logo = `image/png;base64,${readFileSync("public/chivita-logo.png").toString("base64")}`;

export const data: DeckData = {
  hasDemo: true,
  scope: { template: "monthly", title: "Utility monthly report", from: "2026-10-01", to: "2026-10-31", area: "", sections: SECTION_KEYS,
           commentary: { downtime: "Compressor 5 bearing failure drove most hours." } },
  dash: {
    compliance: { due: 100, filled: 96, pct: 96 }, openFlags: 4, criticalFlags: 1, openDowntime: 2, onDuty: [], outOfSpec24h: 3, early24h: 0, missingOpen: 1,
    kpis: [{ asset_id: "a", code: "CMP-05", name: "Air Compressor 5", failures: 2, unplanned_hours: 9.5, planned_hours: 0, external_hours: 0, operating_hours: 700,
             operating_hours_estimated: false, mttr: 4.75, mtbf: 350, availability: 0.987 }],
    fleet: { events: 2, unplannedHours: 9.5, mttr: 4.75, availability: 0.995 },
    pareto: [{ label: "Bearing failure", hours: 7, events: 1 }, { label: "Air leak", hours: 2.5, events: 1 }],
    trend: [], hasDemo: true,
  },
  topEvents: [{ event_no: "DT-0012", code: "CMP-05", name: "Air Compressor 5", type: "Unplanned Breakdown", mode: "Bearing failure", hours: 7, status: "Closed" }],
  rcas: [{ rca_no: "RCA-004", problem: "Repeated bearing failure", status: "In Progress", target_date: "2026-10-20", overdue: true, code: "CMP-05" }],
  readings: [{ title: "U1 Boiler Log", document_no: "CHIENGUTRG03", area: "U1", ok: 950, oos: 12, crit: 1, missing: 3, late: 5 }],
  pm: [{ frequency: "daily", tasks: 40, due: 1240, ok: 1150, nok: 20, nd: 30 }, { frequency: "weekly", tasks: 30, due: 120, ok: 100, nok: 5, nd: 10 }],
  amc: [{ contract: "Chiller AMC", vendor: "Vendor A", planned: 1, done: 1 }],
  consumption: [{ group: "daily", name: "Steam Boiler 1 – gas flow", unit: "m³", kind: "totaliser", total: 66000 },
                { group: "energy", name: "Air Compressor 5", unit: "kWh", kind: "totaliser", total: 42000 },
                { group: "water", name: "Line 1 – Expansion", unit: "m³", kind: "totaliser", total: 4200 }],
  water: { ok: 40, alert: 2, action: 1, overdueCal: 1, dueSoonCal: 3, instruments: 12 },
  kpiDefs: [{ code: "pm", name: "PM Task Completion %", target_min: 85 }, { code: "leakage", name: "Leakage Identification & Closure %", target_min: 95 }],
  engineers: [{ name: "Samuel Majekodunmi", values: { pm: 88.3, leakage: null } }],
  training: { planned: 15, completed: 3, pastDue: 0, byCourse: [{ course: "Industrial Chillers", planned: 1, done: 0 }] },
};

