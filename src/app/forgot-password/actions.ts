"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface ResetState { ok?: string; error?: string }

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

/** Emails a password-reset link. The answer is the same whether or not the email has an account. */
export async function requestReset(_p: ResetState, f: FormData): Promise<ResetState> {
  const email = String(f.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { error: "Enter your email address." };
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/confirm?next=/reset-password` });
  if (error && /rate|limit/i.test(error.message)) return { error: "Too many reset emails were sent. Wait a few minutes and try again, or ask an admin." };
  return { ok: "If that email has an account, a reset link is on its way. Open it on this device. Check the spam folder too." };
}

/** Sets the new password for the user who arrived through the reset link. */
export async function setNewPassword(_p: ResetState, f: FormData): Promise<ResetState> {
  const pw = String(f.get("password") ?? "");
  if (pw.length < 8) return { error: "Use at least 8 characters." };
  if (pw !== String(f.get("confirm") ?? "")) return { error: "The two passwords do not match." };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "The reset link has expired. Ask for a new one." };
  const { error } = await supabase.auth.updateUser({ password: pw });
  if (error) return { error: error.message };
  redirect("/?password=changed");
}
