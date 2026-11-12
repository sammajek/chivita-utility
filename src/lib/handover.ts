/** Equipment groups on the UTILITY HANDOVER REPORT sheet, in its order, mapped to equipment categories / names. */
export const HANDOVER_GROUPS: { key: string; label: string; cats: string[]; nameHas?: string }[] = [
  { key: "Compressors", label: "Compressors", cats: ["Air Compressors"] },
  { key: "Dryer", label: "Dryer", cats: ["Air Dryers"] },
  { key: "Chiller", label: "Chiller", cats: ["Chillers"] },
  { key: "Cooling tower", label: "Cooling tower", cats: ["Chillers"], nameHas: "Cooling Tower" },
  { key: "Boiler", label: "Boiler", cats: ["Boilers"] },
  { key: "Fire hydrant", label: "Fire hydrant", cats: [] },
  { key: "Borehole", label: "Borehole", cats: ["Boreholes"] },
  { key: "Degasser", label: "Degasser", cats: ["Degassers"] },
];

/** Tick-box choices for each machine on the handover. */
export const MACHINE_STATUS = [
  { v: "running", label: "Running" },
  { v: "standby", label: "Standby" },
  { v: "fault", label: "Maint. / fault" },
] as const;
export type MachineStatus = (typeof MACHINE_STATUS)[number]["v"] | "";

export interface MachineItem { code: string; name: string; status: MachineStatus }
export interface GroupStatus { running: string; standby: string; faults: string; items?: MachineItem[]; note?: string }
export interface HandoverContent {
  groups: Record<string, GroupStatus>;
  fuel: string;
  wtp: { raw_running: string; treated_running: string; standby: string; ph: string; raw_level: string; treated_level: string; faults: string;
    items?: MachineItem[]; note?: string };
  caustic: string;
  checklist: Record<string, { answer: "yes" | "no" | "na"; note?: string }>;
}

/** Summary strings in the template's columns from the ticked machines (plus the fault note). */
export function summarise(items: MachineItem[], note: string) {
  const codes = (s: MachineStatus) => items.filter((i) => i.status === s).map((i) => i.code).join(", ");
  return { running: codes("running"), standby: codes("standby"), faults: [codes("fault"), note].filter(Boolean).join(" – ") };
}

export type ShiftKey = { shiftDate: string; shift: "day" | "night" };
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const nextShift = ({ shiftDate, shift }: ShiftKey): ShiftKey =>
  shift === "day" ? { shiftDate, shift: "night" } : { shiftDate: plusDays(shiftDate, 1), shift: "day" };
export const prevShift = ({ shiftDate, shift }: ShiftKey): ShiftKey =>
  shift === "night" ? { shiftDate, shift: "day" } : { shiftDate: plusDays(shiftDate, -1), shift: "night" };
