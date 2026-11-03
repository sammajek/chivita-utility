import { createClient } from "@/lib/supabase/server";
import { loadDashboard, type DashboardData } from "@/lib/data/dashboard";
import { dailyUseByMeter } from "@/lib/consumption";
import { ratioFor, weeklyParts, type Part, type WeeklyLog } from "@/lib/engineer-kpi";
import { addDays, lagosInstant } from "@/lib/time";
import type { DeckScope, SectionKey } from "./sections";

export interface DeckData {
  scope: DeckScope;
  dash?: DashboardData;
  topEvents?: { event_no: string; code: string; name: string; type: string; mode: string; hours: number; status: string }[];
  rcas?: { rca_no: string; problem: string; status: string; target_date: string | null; overdue: boolean; code: string }[];
  readings?: { title: string; document_no: string; area: string; ok: number; oos: number; crit: number; missing: number; late: number }[];
  pm?: { frequency: string; tasks: number; due: number; ok: number; nok: number; nd: number }[];
  amc?: { contract: string; vendor: string; planned: number; done: number }[];
  consumption?: { group: string; name: string; unit: string | null; total: number; kind: string }[];
  water?: { ok: number; alert: number; action: number; overdueCal: number; dueSoonCal: number; instruments: number };
  engineers?: { name: string; values: Record<string, number | null> }[];
  kpiDefs?: { code: string; name: string; target_min: number }[];
  training?: { planned: number; completed: number; pastDue: number; byCourse: { course: string; planned: number; done: number }[] };
  hasDemo: boolean;
}

/** Loads only what the chosen sections need, for the chosen period and area. */
export async function loadDeckData(scope: DeckScope): Promise<DeckData> {
  const supabase = await createClient();
  const want = (k: SectionKey) => scope.sections.includes(k);
  const from = lagosInstant(scope.from, 7);                 // log days run 07:00 → 07:00
  const to = lagosInstant(addDays(scope.to, 1), 7);
  const area = scope.area || null;
  const out: DeckData = { scope, hasDemo: false };

  if (want("summary") || want("downtime")) {
    out.dash = await loadDashboard(from, to, area);
    out.hasDemo ||= out.dash.hasDemo;
  }
  if (want("downtime")) {
    let q = supabase.from("downtime_events").select("event_no, downtime_type, failure_mode, start_at, end_at, override_hours, status, area, asset:assets(code, name)")
      .is("voided_at", null).gte("start_at", from.toISOString()).lt("start_at", to.toISOString()).limit(2000);
    if (area) q = q.eq("area", area);
    const { data } = await q;
    out.topEvents = ((data ?? []) as unknown as { event_no: string; downtime_type: string; failure_mode: string; start_at: string; end_at: string | null; override_hours: number | null; status: string; asset: { code: string; name: string } | null }[])
      .map((e) => ({ event_no: e.event_no, code: e.asset?.code ?? "", name: e.asset?.name ?? "", type: e.downtime_type, mode: e.failure_mode, status: e.status,
        hours: e.override_hours ?? ((e.end_at ? Date.parse(e.end_at) : Date.now()) - Date.parse(e.start_at)) / 3_600_000 }))
      .sort((a, b) => b.hours - a.hours).slice(0, 8);
  }
  if (want("rca")) {
    const { data } = await supabase.from("rcas").select("rca_no, problem, status, target_date, asset:assets(code, area)").order("rca_no", { ascending: false }).limit(200);
    const today = scope.to;
    out.rcas = ((data ?? []) as unknown as { rca_no: string; problem: string; status: string; target_date: string | null; asset: { code: string; area: string | null } | null }[])
      .filter((r) => !area || r.asset?.area === area)
      .filter((r) => !r.status.startsWith("Closed"))
      .map((r) => ({ rca_no: r.rca_no, problem: r.problem, status: r.status, target_date: r.target_date, code: r.asset?.code ?? "",
        overdue: !!r.target_date && r.target_date < today }))
      .slice(0, 12);
  }
  if (want("readings")) {
    const { data } = await supabase.rpc("report_reading_summary", { p_from: from.toISOString(), p_to: to.toISOString(), p_area: area });
    out.readings = ((data ?? []) as { title: string; document_no: string; area: string; ok: number; out_of_spec: number; critical: number; missing_flags: number; late: number }[])
      .map((r) => ({ title: r.title, document_no: r.document_no, area: r.area, ok: Number(r.ok), oos: Number(r.out_of_spec), crit: Number(r.critical), missing: Number(r.missing_flags), late: Number(r.late) }));
  }
  if (want("pm")) {
    const { data } = await supabase.rpc("report_pm_summary", { p_from: scope.from, p_to: scope.to, p_area: area });
    out.pm = ((data ?? []) as { frequency: string; tasks: number; due: number; done_ok: number; done_not_ok: number; not_done: number }[])
      .map((r) => ({ frequency: r.frequency, tasks: Number(r.tasks), due: Number(r.due), ok: Number(r.done_ok), nok: Number(r.done_not_ok), nd: Number(r.not_done) }));
  }
  if (want("amc")) {
    const m0 = `${scope.from.slice(0, 7)}-01`, m1 = `${scope.to.slice(0, 7)}-01`;
    const [{ data: sched }, { data: visits }, { data: contracts }] = await Promise.all([
      supabase.from("amc_schedule").select("contract_id, month, planned").gte("month", m0).lte("month", m1),
      supabase.from("amc_visits").select("contract_id, month").gte("month", m0).lte("month", m1).is("voided_at", null),
      supabase.from("amc_contracts").select("id, description, vendor, area").eq("active", true),
    ]);
    const done = new Set((visits ?? []).map((v) => `${v.contract_id}|${v.month}`));
    out.amc = ((contracts ?? []) as { id: string; description: string; vendor: string; area: string | null }[])
      .filter((c) => !area || !c.area || c.area === area)
      .map((c) => {
        const planned = (sched ?? []).filter((s) => s.contract_id === c.id && s.planned);
        return { contract: c.description, vendor: c.vendor, planned: planned.length, done: planned.filter((s) => done.has(`${c.id}|${s.month}`)).length };
      });
  }
  if (want("consumption")) {
    const { data } = await supabase.from("meter_usage").select("meter_id, code, name, grp, unit, kind, read_date, value, used, is_reset, comment, is_demo")
      .gt("read_date", scope.from).lte("read_date", addDays(scope.to, 1)).limit(20000);
    const rows = (data ?? []) as { meter_id: string; code: string; name: string; grp: string; unit: string | null; kind: string; read_date: string; value: number; used: number | null; is_reset: boolean; comment: string | null; is_demo: boolean }[];
    out.hasDemo ||= rows.some((r) => r.is_demo);
    const by = dailyUseByMeter(rows);
    const meta = new Map(rows.map((r) => [r.meter_id, r]));
    out.consumption = [...by.entries()].map(([id, u]) => {
      const m = meta.get(id)!;
      return { group: m.grp, name: m.name, unit: m.unit, kind: m.kind, total: m.kind === "rate" ? u.avg ?? 0 : u.total };
    });
  }
  if (want("water")) {
    const [{ data: wr }, { data: ins }] = await Promise.all([
      supabase.from("water_results").select("status, is_demo").gte("sampled_on", scope.from).lte("sampled_on", scope.to).is("voided_at", null).limit(5000),
      supabase.from("instruments").select("next_due, area").eq("active", true),
    ]);
    const w = (wr ?? []) as { status: string; is_demo: boolean }[];
    out.hasDemo ||= w.some((x) => x.is_demo);
    const inst = ((ins ?? []) as { next_due: string | null; area: string | null }[]).filter((i) => !area || i.area === area);
    out.water = {
      ok: w.filter((x) => x.status === "ok").length, alert: w.filter((x) => x.status === "alert").length, action: w.filter((x) => x.status === "action").length,
      overdueCal: inst.filter((i) => i.next_due && i.next_due < scope.to).length,
      dueSoonCal: inst.filter((i) => i.next_due && i.next_due >= scope.to && i.next_due <= addDays(scope.to, 30)).length,
      instruments: inst.length,
    };
  }
  if (want("engineers")) {
    const year = Number(scope.to.slice(0, 4));
    const months = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => {
      const ms = `${year}-${String(m).padStart(2, "0")}`;
      return ms >= scope.from.slice(0, 7) && ms <= scope.to.slice(0, 7);
    });
    const [{ data: defs }, { data: staff }] = await Promise.all([
      supabase.from("kpi_definitions").select("code, name, target_min").order("sort"),
      supabase.from("staff").select("id, full_name, band, profile_id, area").eq("active", true).not("profile_id", "is", null).order("first_name"),
    ]);
    out.kpiDefs = (defs ?? []) as { code: string; name: string; target_min: number }[];
    const people = ((staff ?? []) as { id: string; full_name: string; profile_id: string; area: string | null }[]).filter((s) => !area || !s.area || s.area === area);
    out.engineers = await Promise.all(people.map(async (s) => {
      const [{ data: auto }, { data: logs }] = await Promise.all([
        supabase.rpc("engineer_kpi_auto", { p_profile: s.profile_id, p_year: year }),
        supabase.from("engineer_weekly_logs").select("*").eq("staff_ref", s.id).gte("week_start", `${year}-01-01`).lte("week_start", `${year}-12-31`),
      ]);
      const parts: Part[] = [
        ...((auto ?? []) as { month: string; kpi: string; num: number; den: number }[]).map((a) => ({ month: Number(a.month.slice(5, 7)), kpi: a.kpi, num: Number(a.num), den: Number(a.den) })),
        ...weeklyParts((logs ?? []) as WeeklyLog[]),
      ];
      return { name: s.full_name, values: Object.fromEntries(out.kpiDefs!.map((d) => [d.code, ratioFor(parts, d.code, months)])) };
    }));
  }
  if (want("training")) {
    const { data } = await supabase.from("training_plans").select("status, planned_end, course:training_courses(title), staff:staff(area)").is("voided_at", null).limit(2000);
    const rows = ((data ?? []) as unknown as { status: string; planned_end: string | null; course: { title: string } | null; staff: { area: string | null } | null }[])
      .filter((r) => !area || !r.staff?.area || r.staff.area === area);
    const byCourse = new Map<string, { planned: number; done: number }>();
    for (const r of rows) {
      const k = r.course?.title ?? "—";
      const c = byCourse.get(k) ?? { planned: 0, done: 0 };
      c.planned += 1;
      if (r.status === "completed") c.done += 1;
      byCourse.set(k, c);
    }
    out.training = {
      planned: rows.length, completed: rows.filter((r) => r.status === "completed").length,
      pastDue: rows.filter((r) => r.status === "planned" && r.planned_end && r.planned_end < scope.to).length,
      byCourse: [...byCourse.entries()].map(([course, c]) => ({ course, ...c })).sort((a, b) => b.planned - a.planned),
    };
  }
  return out;
}
