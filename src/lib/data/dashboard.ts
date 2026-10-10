import { createClient } from "@/lib/supabase/server";
import { assetKpis, hoursInPeriod, UNPLANNED, type AssetKpi, type DowntimeEvent } from "@/lib/kpi";
import { logDateOf } from "@/lib/registers";

const COUNTER_NAMES = ["Running Hours", "Operating Hours", "Compressor Running Time"];

export interface DashboardData {
  compliance: { due: number; filled: number; pct: number | null };
  openFlags: number;
  criticalFlags: number;
  openDowntime: number;
  onDuty: { name: string; areas: string[] }[];
  outOfSpec24h: number;
  kpis: (AssetKpi & { code: string; name: string })[];
  fleet: { events: number; unplannedHours: number; mttr: number | null; availability: number | null };
  pareto: { label: string; hours: number; events: number }[];
  trend: { label: string; hours: number; events: number }[];
  hasDemo: boolean;
}

export async function loadDashboard(from: Date, to: Date, area: string | null): Promise<DashboardData> {
  const supabase = await createClient();
  const today = logDateOf(new Date());
  const now = new Date();

  const [slots, fields, todays, flags, duty, dt, oos, counterParams] = await Promise.all([
    supabase.rpc("register_slots", { p_log_date: today } as never),
    supabase.from("register_fields").select("id, section_id"),
    supabase.from("readings").select("field_id, slot_key").eq("log_date", today).is("voided_at", null).limit(50000),
    supabase.from("flags").select("severity, is_demo").is("resolved_at", null),
    supabase.from("duty_sessions").select("areas, checked_out_at, profile:profiles(full_name)").is("checked_out_at", null),
    supabase.from("downtime_events")
      .select("asset_id, downtime_type, start_at, end_at, override_hours, status, failure_mode, area, is_demo, asset:assets(code, name, area)")
      .is("voided_at", null).gte("start_at", new Date(from.getTime() - 30 * 86_400_000).toISOString()).limit(5000),
    supabase.from("readings").select("id", { count: "exact", head: true }).in("status", ["out_of_spec", "critical"])
      .is("voided_at", null).gte("reading_for", new Date(now.getTime() - 86_400_000).toISOString()),
    supabase.from("parameters").select("id").eq("is_counter", true).in("name", COUNTER_NAMES),
  ]);

  // Compliance: share of slots due so far today that have at least one value.
  const sectionOf = new Map(((fields.data ?? []) as { id: string; section_id: string }[]).map((f) => [f.id, f.section_id]));
  const filledKeys = new Set(((todays.data ?? []) as { field_id: string; slot_key: string }[]).map((r) => `${sectionOf.get(r.field_id)}|${r.slot_key}`));
  const dueSlots = ((slots.data ?? []) as { section_id: string; slot_key: string; due_at: string }[]).filter((s) => new Date(s.due_at) <= now);
  const filled = dueSlots.filter((s) => filledKeys.has(`${s.section_id}|${s.slot_key}`)).length;

  type Ev = DowntimeEvent & { status: string; failure_mode: string; area: string | null; is_demo: boolean; asset: { code: string; name: string; area: string | null } | null };
  const events = ((dt.data ?? []) as unknown as Ev[]).filter((e) => !area || e.area === area);
  const inPeriod = events.filter((e) => new Date(e.start_at) >= from && new Date(e.start_at) < to);

  const counterIds = ((counterParams.data ?? []) as { id: string }[]).map((p) => p.id);
  const assetIds = [...new Set(inPeriod.map((e) => e.asset_id))];
  const counters = new Map<string, { at: string; value: number }[]>();
  if (counterIds.length && assetIds.length) {
    const { data: cr } = await supabase.from("readings").select("asset_id, reading_for, value_num")
      .in("parameter_id", counterIds).in("asset_id", assetIds).is("voided_at", null)
      .gte("reading_for", from.toISOString()).lt("reading_for", to.toISOString()).limit(20000);
    for (const r of (cr ?? []) as { asset_id: string; reading_for: string; value_num: number }[]) {
      const list = counters.get(r.asset_id) ?? [];
      list.push({ at: r.reading_for, value: r.value_num });
      counters.set(r.asset_id, list);
    }
  }
  const names = new Map(events.map((e) => [e.asset_id, e.asset]));
  const kpis = assetKpis(assetIds, events, counters, from, to, now)
    .map((k) => ({ ...k, code: names.get(k.asset_id)?.code ?? "", name: names.get(k.asset_id)?.name ?? "" }))
    .sort((a, b) => b.unplanned_hours - a.unplanned_hours);

  const unplanned = inPeriod.filter((e) => e.downtime_type === UNPLANNED);
  const unplannedHours = unplanned.reduce((t, e) => t + hoursInPeriod(e, from, to, now), 0);
  const nAssets = Math.max(1, kpis.length);
  const sched = (Math.min(to.getTime(), now.getTime()) - from.getTime()) / 3_600_000;

  const group = (key: (e: Ev) => string) => {
    const m = new Map<string, { hours: number; events: number }>();
    for (const e of unplanned) {
      const k = key(e);
      const g = m.get(k) ?? { hours: 0, events: 0 };
      g.hours += hoursInPeriod(e, from, to, now);
      g.events += 1;
      m.set(k, g);
    }
    return [...m.entries()].map(([label, g]) => ({ label, ...g }));
  };
  const weekOf = (iso: string) => {
    const d = new Date(iso);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000);
    return monday.toISOString().slice(0, 10);
  };

  const flagRows = (flags.data ?? []) as { severity: string; is_demo: boolean }[];
  return {
    compliance: { due: dueSlots.length, filled, pct: dueSlots.length ? (filled / dueSlots.length) * 100 : null },
    openFlags: flagRows.length,
    criticalFlags: flagRows.filter((f) => f.severity === "critical").length,
    openDowntime: events.filter((e) => e.status !== "Closed").length,
    onDuty: ((duty.data ?? []) as unknown as { areas: string[]; profile: { full_name: string } | null }[]).map((d) => ({ name: d.profile?.full_name ?? "", areas: d.areas })),
    outOfSpec24h: oos.count ?? 0,
    kpis,
    fleet: {
      events: unplanned.length,
      unplannedHours,
      mttr: unplanned.length ? unplanned.reduce((t, e) => t + hoursInPeriod(e, new Date(0), new Date(8.64e15), now), 0) / unplanned.length : null,
      availability: sched > 0 ? Math.max(0, 1 - unplannedHours / (sched * nAssets)) : null,
    },
    pareto: group((e) => e.failure_mode).sort((a, b) => b.hours - a.hours).slice(0, 10),
    trend: group((e) => weekOf(e.start_at)).sort((a, b) => a.label.localeCompare(b.label)),
    hasDemo: events.some((e) => e.is_demo) || flagRows.some((f) => f.is_demo),
  };
}
