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

export interface NavItem {
  href: string;
  label: string;
  roles: readonly Role[];
  /** Phase-1 step that delivers the screen; shown as "coming soon" until built. */
  ready: boolean;
}

const ALL: readonly Role[] = ROLES;
const ENGINEER_UP: readonly Role[] = ["engineer", "shift_manager", "section_manager", "admin"];

export const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", roles: ALL, ready: true },
  { href: "/registers", label: "Registers", roles: ["operator", ...ENGINEER_UP], ready: false },
  { href: "/duty", label: "On duty", roles: ENGINEER_UP, ready: false },
  { href: "/downtime", label: "Downtime", roles: ["operator", ...ENGINEER_UP, "viewer"], ready: false },
  { href: "/rca", label: "RCA", roles: [...ENGINEER_UP, "viewer"], ready: false },
  { href: "/admin", label: "Admin", roles: ["admin", "section_manager"], ready: false },
];

export function navFor(role: Role | null | undefined): NavItem[] {
  if (!role) return [];
  return NAV.filter((n) => n.roles.includes(role));
}
