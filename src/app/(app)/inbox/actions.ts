"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function acknowledge(_p: { ok?: string; error?: string }, f: FormData) {
  const supabase = await createClient();
  const ids = f.getAll("id").map(String);
  for (const id of ids) {
    const { error } = await supabase.rpc("acknowledge_notification", { p_id: id });
    if (error) return { error: error.message };
  }
  revalidatePath("/", "layout");
  return { ok: ids.length > 1 ? "All marked as read." : "Marked as read." };
}
