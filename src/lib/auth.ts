import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  role: Role;
  areas: ("U1" | "U2")[];
  active: boolean;
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
    .select("id, full_name, email, role, areas, active")
    .eq("id", user.id)
    .single<Profile>();

  if (!data || !data.active) {
    return { id: user.id, full_name: user.email ?? "Unknown user", email: user.email ?? null, role: "viewer", areas: [], active: false };
  }
  return data;
});

export async function requireRole(...roles: Role[]): Promise<Profile> {
  const profile = await requireProfile();
  if (!roles.includes(profile.role)) redirect("/?denied=1");
  return profile;
}
