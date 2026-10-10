import { createClient } from "@/lib/supabase/server";
import { fieldsFor, loadRegister, type RegisterDetail } from "@/lib/data/registers";
import type { Asset, Field } from "@/lib/types";

export interface TrendPoint {
  at: string; // reading_for (ISO)
  value: number | null;
  text: string | null;
  status: string;
  comment: string | null;
  recordedBy: string | null;
  recordedAt: string;
  isDemo: boolean;
}

export interface TrendData {
  detail: RegisterDetail;
  /** Fields that can be trended for the chosen asset, with their section title. */
  choices: { field: Field; section: string }[];
  field: Field | null;
  asset: Asset | null;
  days: number;
  from: Date;
  to: Date;
  points: TrendPoint[];
}

export const TREND_DAYS = [1, 7, 30, 90] as const;

export async function loadTrend(
  key: string,
  q: { field?: string; asset?: string; days?: string },
): Promise<TrendData | null> {
  const detail = await loadRegister(key);
  if (!detail) return null;
  const multi = detail.assets.length > 0;
  const asset = multi ? (detail.assets.find((a) => a.id === q.asset) ?? detail.assets[0]) : null;
  const choices = detail.sections.flatMap((s) =>
    fieldsFor(s, asset?.id ?? null, multi).map((field) => ({ field, section: s.title })),
  );
  const numeric = choices.filter((c) => c.field.parameter.data_type === "number");
  const field =
    choices.find((c) => c.field.id === q.field)?.field ?? numeric[0]?.field ?? choices[0]?.field ?? null;
  const days = TREND_DAYS.includes(Number(q.days) as (typeof TREND_DAYS)[number]) ? Number(q.days) : 7;
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);

  let points: TrendPoint[] = [];
  if (field) {
    const supabase = await createClient();
    let query = supabase
      .from("readings")
      .select("reading_for, value_num, value_text, status, comment, recorded_by_id, recorded_at, is_demo")
      .eq("field_id", field.id)
      .gte("reading_for", from.toISOString())
      .lte("reading_for", to.toISOString())
      .is("voided_at", null)
      .order("reading_for")
      .limit(5000);
    if (asset && !field.asset_id) query = query.eq("asset_id", asset.id);
    const { data } = await query;
    type Row = {
      reading_for: string; value_num: number | null; value_text: string | null; status: string;
      comment: string | null; recorded_by_id: string | null; recorded_at: string; is_demo: boolean;
    };
    const rows = (data ?? []) as Row[];
    const ids = [...new Set(rows.map((r) => r.recorded_by_id).filter(Boolean))] as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: people } = await supabase.from("profiles").select("id, full_name").in("id", ids);
      for (const p of people ?? []) names.set(p.id, p.full_name);
    }
    points = rows.map((r) => ({
      at: r.reading_for,
      value: r.value_num === null ? null : Number(r.value_num),
      text: r.value_text,
      status: r.status,
      comment: r.comment,
      recordedBy: r.recorded_by_id ? (names.get(r.recorded_by_id) ?? null) : null,
      recordedAt: r.recorded_at,
      isDemo: r.is_demo,
    }));
  }
  return { detail, choices, field, asset, days, from, to, points };
}
