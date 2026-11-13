export const ROLES = ["operator", "engineer", "shift_manager", "section_manager", "admin", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  operator: "Operator",
  engineer: "Engineer",
  shift_manager: "Shift Manager",
  section_manager: "Section Manager",
  admin: "Admin",
  viewer: "Viewer",
};

/** Groups of actions an admin can give or take away per role (Admin → Access). Enforced by the database. */
export const CAPABILITIES = [
  { key: "enter_records", label: "Enter records",
    detail: "Readings, PM results, downtime, water results, cleaning checks, patrols, evidence photos; change equipment state; correct or void own entries; check in/out and handover" },
  { key: "engineer_tasks", label: "Engineer tasks",
    detail: "Correct or void anyone’s records; close downtime; resolve flags and follow-ups; RCA; calibration; AMC visits; jobs & POs; affirm PM periods; tick training; loggers" },
  { key: "shift_manager_tasks", label: "Shift manager tasks",
    detail: "Sign off handovers and cleaning; set up patrol points; KPI entries for others; issue machine scan labels" },
  { key: "manager_tasks", label: "Section manager tasks",
    detail: "Admin screen: edit equipment, limits, registers, PM tasks, meters, pick lists, staff; AMC contracts and planned months; withdraw PM affirmations" },
  { key: "admin_tasks", label: "Admin tasks",
    detail: "Activate users and change roles; import staff; issue logger keys; change these access rights" },
] as const;
export type Capability = (typeof CAPABILITIES)[number]["key"];

export const NAV_GROUPS = ["Overview", "Operations", "Maintenance", "Quality", "People", "Reports & data"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number] | "Admin";

export interface NavItem {
  href: string;
  label: string;
  group: NavGroup;
  roles: readonly Role[];
}

const ALL: readonly Role[] = ROLES;
const ENGINEER_UP: readonly Role[] = ["engineer", "shift_manager", "section_manager", "admin"];
const FLOOR: readonly Role[] = ["operator", ...ENGINEER_UP, "viewer"];

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", group: "Overview", roles: ALL },
  { href: "/flags", label: "Flags", group: "Overview", roles: ALL },
  { href: "/duty", label: "On Duty", group: "Overview", roles: ALL },
  { href: "/handover", label: "Handover", group: "Overview", roles: ALL },
  { href: "/oee", label: "OEE", group: "Overview", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/registers", label: "Equipment Registers", group: "Operations", roles: FLOOR },
  { href: "/equipment", label: "Equipment Inventory", group: "Operations", roles: ALL },
  { href: "/downtime", label: "Downtime Log & Analysis", group: "Operations", roles: FLOOR },
  { href: "/rca", label: "RCA Log & Analysis", group: "Operations", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/consumption", label: "Utility Consumption", group: "Operations", roles: FLOOR },
  { href: "/patrol", label: "Area Patrols", group: "Operations", roles: ALL },
  { href: "/outage", label: "Outage Plan", group: "Operations", roles: ALL },
  { href: "/pm", label: "Preventive Maintenance", group: "Maintenance", roles: FLOOR },
  { href: "/amc", label: "Annual Maintenance Contract", group: "Maintenance", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/jobs", label: "Job Orders & POs", group: "Maintenance", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/cleaning", label: "Cleaning Schedule", group: "Maintenance", roles: FLOOR },
  { href: "/water", label: "Water Quality", group: "Quality", roles: FLOOR },
  { href: "/calibration", label: "Instrument Calibration", group: "Quality", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/kpi", label: "Engineer KPIs", group: "People", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/training", label: "Training", group: "People", roles: ALL },
  { href: "/reports", label: "Reports", group: "Reports & data", roles: ALL },
  { href: "/loggers", label: "Loggers", group: "Reports & data", roles: ENGINEER_UP },
  { href: "/admin", label: "Admin", group: "Admin", roles: ["admin", "section_manager"] },
];

export function navFor(role: Role | null | undefined): NavItem[] {
  if (!role) return [];
  return NAV.filter((n) => n.roles.includes(role));
}
