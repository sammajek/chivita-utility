import { createClient } from "@/lib/supabase/server";
import type { Asset, Field, Parameter, Register, Section } from "@/lib/types";

const PARAM_COLS =
  "id, equipment_group, name, unit, data_type, options, ok_options, std_min, std_max, crit_min, crit_max, standard_as_written, alt_standard, needs_review, review_note, is_counter";

export interface RegisterDetail {
  register: Register;
  sections: Section[];
  assets: Asset[];
  /** Assets pinned to individual fields (e.g. each pressure filter tank). */
  fieldAssets: Record<string, Asset>;
}

export async function loadRegister(key: string): Promise<RegisterDetail | null> {
  const supabase = await createClient();
  const { data: register } = await supabase
    .from("registers")
    .select("id, key, area, document_no, title, description, monitor, sort")
    .eq("key", key)
    .eq("active", true)
    .maybeSingle<Register>();
  if (!register) return null;

  const [{ data: secs }, { data: ra }] = await Promise.all([
    supabase
      .from("register_sections")
      .select(`id, title, slot_kind, slot_times, sort, register_fields(id, section_id, label, asset_id, sort, active, parameter:parameters(${PARAM_COLS}))`)
      .eq("register_id", register.id)
      .order("sort"),
    supabase
      .from("register_assets")
      .select("sort, asset:assets(id, code, name, area, category_id, confirmed, status, make, notes)")
      .eq("register_id", register.id)
      .order("sort"),
  ]);

  type RawField = Omit<Field, "parameter"> & { active: boolean; parameter: Parameter };
  type RawSection = Omit<Section, "fields"> & { register_fields: RawField[] };
  const sections: Section[] = ((secs ?? []) as unknown as RawSection[]).map((s) => ({
    id: s.id,
    title: s.title,
    slot_kind: s.slot_kind,
    slot_times: s.slot_times,
    sort: s.sort,
    fields: s.register_fields.filter((f) => f.active).sort((a, b) => a.sort - b.sort),
  }));
  const assets = ((ra ?? []) as unknown as { asset: Asset }[]).map((r) => r.asset);

  const pinnedIds = [...new Set(sections.flatMap((s) => s.fields.map((f) => f.asset_id)).filter(Boolean))] as string[];
  const fieldAssets: Record<string, Asset> = {};
  if (pinnedIds.length) {
    const { data } = await supabase
      .from("assets")
      .select("id, code, name, area, category_id, confirmed, status, make, notes")
      .in("id", pinnedIds);
    for (const a of (data ?? []) as Asset[]) fieldAssets[a.id] = a;
  }
  return { register, sections, assets, fieldAssets };
}

/** Fields of a section that apply to one asset: unpinned fields, or fields pinned to it. */
export function fieldsFor(section: Section, assetId: string | null, multiAsset: boolean): Field[] {
  if (!multiAsset) return section.fields;
  return section.fields.filter((f) => f.asset_id === null || f.asset_id === assetId);
}
