import { createClient } from "@/lib/supabase/server";

export interface ListItem {
  list_name: string;
  value: string;
  parent: string | null;
}

/** Pick-lists from the 603-001 template, grouped by list name. */
export async function loadLists(): Promise<Record<string, ListItem[]>> {
  const supabase = await createClient();
  const { data } = await supabase.from("lists").select("list_name, value, parent").eq("active", true).order("sort");
  const out: Record<string, ListItem[]> = {};
  for (const r of (data ?? []) as ListItem[]) (out[r.list_name] ??= []).push(r);
  return out;
}

export async function loadAssetsForPicker() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("assets")
    .select("id, code, name, area, status, category:asset_categories(name, sort)")
    .neq("status", "retired")
    .order("code");
  return (data ?? []) as unknown as { id: string; code: string; name: string; area: string | null; category: { name: string; sort: number } }[];
}
