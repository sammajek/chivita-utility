/** Deck sections and the ready-made templates that combine them (CLAUDE.md module 9). */
export const SECTIONS = {
  summary: "Summary: key figures",
  downtime: "Downtime: Pareto and main events",
  rca: "RCA status and actions",
  readings: "Equipment register compliance",
  pm: "Preventive maintenance adherence",
  amc: "AMC compliance",
  consumption: "Energy & consumption",
  water: "Water quality & calibration",
  engineers: "Engineer KPIs",
  training: "Training",
} as const;
export type SectionKey = keyof typeof SECTIONS;
export const SECTION_KEYS = Object.keys(SECTIONS) as SectionKey[];

export const TEMPLATES: Record<string, { name: string; days: number; sections: SectionKey[] }> = {
  weekly: { name: "Weekly utility review", days: 7, sections: ["summary", "downtime", "readings", "pm", "consumption", "water"] },
  monthly: { name: "Monthly management report", days: 30, sections: ["summary", "downtime", "rca", "readings", "pm", "amc", "consumption", "water", "engineers", "training"] },
  downtime: { name: "Downtime & RCA", days: 30, sections: ["summary", "downtime", "rca"] },
  pmamc: { name: "PM & AMC compliance", days: 30, sections: ["pm", "amc"] },
  energy: { name: "Energy & consumption", days: 30, sections: ["consumption"] },
  people: { name: "Engineer performance", days: 30, sections: ["engineers", "training"] },
  custom: { name: "Custom deck", days: 7, sections: [] },
};

export interface DeckScope {
  template: string;
  title: string;
  from: string; // YYYY-MM-DD (Lagos), inclusive
  to: string; // YYYY-MM-DD (Lagos), inclusive
  area: "" | "U1" | "U2";
  sections: SectionKey[];
  commentary: Partial<Record<SectionKey, string>>;
}
