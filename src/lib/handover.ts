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

export interface GroupStatus { running: string; standby: string; faults: string }
export interface HandoverContent {
  groups: Record<string, GroupStatus>;
  fuel: string;
  wtp: { raw_running: string; treated_running: string; standby: string; ph: string; raw_level: string; treated_level: string; faults: string };
  caustic: string;
  checklist: Record<string, { answer: "yes" | "no" | "na"; note?: string }>;
}
