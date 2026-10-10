// Row shapes used by the screens (subset of the database schema).
export type Area = "U1" | "U2";
export type SlotKind = "time" | "shift" | "daily_high_low" | "daily";
export type Status = "ok" | "out_of_spec" | "critical" | "info";

export interface Register {
  id: string;
  key: string;
  area: Area;
  document_no: string;
  title: string;
  description: string | null;
  monitor: boolean;
  sort: number;
}

export interface Parameter {
  id: string;
  equipment_group: string;
  name: string;
  unit: string | null;
  data_type: "number" | "select" | "text";
  options: string[] | null;
  ok_options: string[] | null;
  std_min: number | null;
  std_max: number | null;
  crit_min: number | null;
  crit_max: number | null;
  standard_as_written: string | null;
  alt_standard: string | null;
  needs_review: boolean;
  review_note: string | null;
  is_counter: boolean;
}

export interface Field {
  id: string;
  section_id: string;
  label: string;
  asset_id: string | null;
  sort: number;
  parameter: Parameter;
}

export interface Section {
  id: string;
  title: string;
  slot_kind: SlotKind;
  slot_times: string[] | null;
  sort: number;
  fields: Field[];
}

export interface Asset {
  id: string;
  code: string;
  name: string;
  area: Area | null;
  category_id: number;
  confirmed: boolean;
  status: string;
  make: string | null;
  notes: string | null;
}

export interface Reading {
  id: string;
  field_id: string;
  asset_id: string;
  log_date: string;
  slot_key: string;
  reading_for: string;
  value_num: number | null;
  value_text: string | null;
  status: Status;
  comment: string | null;
  action_taken: string | null;
  minutes_late: number | null;
  recorded_by_id: string | null;
  recorded_at: string;
  amended: boolean;
  is_demo: boolean;
}
