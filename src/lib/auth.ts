import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { NAV, type Capability, type NavItem, type Role } from "@/lib/roles";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  areas: ("U1" | "U2")[];
  active: boolean;
  /** "shift" (day/night) or "office" (Mon–Fri office hours: no shift check-in expected). */
  work_pattern: "shift" | "office";
  /** Action groups this user's role may do (Admin → Access). Empty when inactive. */
  caps: Capability[];
  /** Screen overrides for this role (path → shown), set on Admin → Access. */
  screens: Record<string, boolean>;
}

/** The signed-in user's profile, or a redirect to /login. Cached per request. */
export const requireProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, areas, active, work_pattern")
    .eq("id", user.id)
    .single<Omit<Profile, "caps" | "screens">>();

  if (!data || !data.active) {
    return { id: user.id, full_name: user.email ?? "Unknown user", email: user.email ?? null, role: "viewer", areas: [], active: false, work_pattern: "shift", caps: [], screens: {} };
  }
  const { data: rights } = await supabase.from("role_capabilities").select("capability, allowed").eq("role", data.role);
  const caps: Capability[] = [];
  const screens: Record<string, boolean> = {};
  for (const r of (rights ?? []) as { capability: string; allowed: boolean }[]) {
    if (r.capability.startsWith("screen:")) screens[r.capability.slice(7)] = r.allowed;
    else if (r.allowed) caps.push(r.capability as Capability);
  }
  return { ...data, caps, screens };
});

/** Whether the user's role has this right (set on Admin → Access; also enforced by the database). */
export function can(profile: Pick<Profile, "active" | "caps">, cap: Capability): boolean {
  return profile.active && profile.caps.includes(cap);
}

/** Screens shown in this user's menu: the default for the role, unless the admin changed it on Admin → Access. */
export function navForProfile(profile: Profile): NavItem[] {
  if (!profile.active) return NAV.filter((n) => n.href === "/");
  return NAV.filter((n) => profile.screens[n.href] ?? n.roles.includes(profile.role));
}

export async function requireCap(cap: Capability): Promise<Profile> {
  const profile = await requireProfile();
  if (!can(profile, cap)) redirect("/?denied=1");
  return profile;
}

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/?denied=1");
  return profile;
}
