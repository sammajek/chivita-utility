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
  { href: "/duty", label: "On duty", group: "Overview", roles: ALL },
  { href: "/handover", label: "Handover", group: "Overview", roles: ALL },
  { href: "/registers", label: "Registers", group: "Operations", roles: FLOOR },
  { href: "/equipment", label: "Equipment", group: "Operations", roles: ALL },
  { href: "/downtime", label: "Downtime", group: "Operations", roles: FLOOR },
  { href: "/rca", label: "RCA", group: "Operations", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/consumption", label: "Consumption", group: "Operations", roles: FLOOR },
  { href: "/outage", label: "Outage plan", group: "Operations", roles: ALL },
  { href: "/pm", label: "PM", group: "Maintenance", roles: FLOOR },
  { href: "/amc", label: "AMC", group: "Maintenance", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/jobs", label: "Jobs & POs", group: "Maintenance", roles: [...ENGINEER_UP, "viewer"] },
  { href: "/cleaning", label: "Cleaning", group: "Maintenance", roles: FLOOR },
  { href: "/water", label: "Water quality", group: "Quality", roles: FLOOR },
  { href: "/calibration", label: "Calibration", group: "Quality", roles: [...ENGINEER_UP, "viewer"] },
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
