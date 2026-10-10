"use server";

import { createClient } from "@/lib/supabase/server";

export interface SignupState {
  error?: string;
  done?: boolean;
}

/**
 * Creates a login request. The new profile starts inactive with the "viewer" role;
 * an admin sets the real role and activates it on the Admin → Users screen.
 */
export async function requestAccess(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (fullName.length < 3) return { error: "Enter your full name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "The two passwords do not match." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) return { error: error.message };
  return { done: true };
}
