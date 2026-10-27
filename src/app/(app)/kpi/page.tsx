import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, lagosDate } from "@/lib/time";
import { QUARTERS, ratioFor, status, weeklyParts, type Part, type WeeklyLog } from "@/lib/engineer-kpi";
import { ActionForm } from "@/components/ActionForm";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { saveWeeklyLog } from "./actions";

export const dynamic = "force-dynamic";

interface Def { code: string; name: string; category: string; target_text: string; target_min: number; source: string; formula: string }
interface Staff { id: string; staff_id: string; full_name: string; band: number | null; job_title: string | null; area: string | null; profile_id: string | null }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CELL = { pass: "bg-green-50 text-ok", fail: "bg-red-50 text-crit", none: "text-gray-400" } as const;
const ICON = { pass: "✅", fail: "❌", none: "—" } as const;

const mondayOf = (d: string) => { const dow = new Date(`${d}T12:00:00Z`).getUTCDay(); return addDays(d, -((dow + 6) % 7)); };

export default async function KpiPage({ searchParams }: { searchParams: Promise<{ staff?: string; year?: string; week?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const today = lagosDate(new Date());
  const year = /^\d{4}$/.test(sp.year ?? "") ? Number(sp.year) : Number(today.slice(0, 4));
  const isMgr = ["shift_manager", "section_manager", "admin"].includes(profile.role);

  const [{ data: defs }, { data: staffData }] = await Promise.all([
    supabase.from("kpi_definitions").select("code, name, category, target_text, target_min, source, formula").order("sort"),
    supabase.from("staff").select("id, staff_id, full_name, band, job_title, area, profile_id").eq("active", true).order("first_name"),
  ]);
  const kpis = (defs ?? []) as Def[];
  const staff = (staffData ?? []) as Staff[];
  const me = staff.find((s) => s.profile_id === profile.id);
  const person = staff.find((s) => s.id === sp.staff) ?? me ?? (isMgr ? staff[0] : undefined);

  if (!person) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">Engineer KPI tracker</h1>
        <p className="card text-sm text-gray-600">Your login is not linked to a staff record yet. Ask an admin to add your email on Admin → Staff.</p>
      </div>
    );
  }

  const [{ data: auto }, { data: weekly }] = await Promise.all([
    person.profile_id ? supabase.rpc("engineer_kpi_auto", { p_profile: person.profile_id, p_year: year }) : Promise.resolve({ data: [] }),
    supabase.from("engineer_weekly_logs").select("*").eq("staff_ref", person.id)
      .gte("week_start", `${year - 1}-12-25`).lte("week_start", `${year}-12-31`).order("week_start", { ascending: false }),
  ]);
  const logs = (weekly ?? []) as (WeeklyLog & Record<string, unknown>)[];
  const parts: Part[] = [
    ...((auto ?? []) as { month: string; kpi: string; num: number; den: number }[]).map((a) => ({ month: Number(a.month.slice(5, 7)), kpi: a.kpi, num: Number(a.num), den: Number(a.den) })),
    ...weeklyParts(logs.filter((l) => l.week_start.startsWith(String(year)))),
  ];
  const canWrite = profile.active && (isMgr || (person.profile_id === profile.id && profile.role !== "operator" && profile.role !== "viewer"));
  const week = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? mondayOf(sp.week) : mondayOf(today);
  const thisWeek = logs.find((l) => l.week_start === week) as Record<string, unknown> | undefined;
  const qs = (o: Record<string, string>) => `/kpi?${new URLSearchParams({ staff: person.id, year: String(year), ...o })}`;

  const num = (name: string, label: string) => (
    <label className="block"><span className="text-xs text-gray-600">{label}</span>
      <input name={name} inputMode="numeric" className="input py-2" defaultValue={thisWeek?.[name] == null ? "" : String(thisWeek[name])} /></label>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Individual Engineer KPI Tracker – FY {year}</h1>
          <p className="text-sm">Engineer: <b>{person.full_name}</b> · Staff ID: {person.staff_id}{person.band ? ` · Band ${person.band}` : ""}{person.area ? ` · ${person.area}` : ""}</p>
          <p className="text-xs text-gray-500">Maintenance and quality KPIs are calculated from the app (my checked-in shifts and areas); safety, leakage and THERMAX come from the weekly log below.</p>
          <PrintButton />
        </div>
        <Logo height={36} />
      </div>
      <form className="no-print flex flex-wrap gap-2">
        {isMgr && (
          <select name="staff" defaultValue={person.id} className="input max-w-xs py-2">
            {staff.map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.staff_id})</option>)}
          </select>
        )}
        <input type="hidden" name={isMgr ? "_" : "staff"} value={person.id} />
        <select name="year" defaultValue={String(year)} className="input w-28 py-2">{[year - 1, year, year + 1].map((y) => <option key={y}>{y}</option>)}</select>
        <button className="btn-secondary min-h-10">Show</button>
      </form>
      {!person.profile_id && <p className="rounded bg-amber-50 px-3 py-2 text-sm text-warn">{person.full_name} has no login yet, so only the weekly-log KPIs can be shown.</p>}

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="w-full min-w-[980px] text-xs">
          <thead className="bg-gray-50 text-gray-600">
            <tr><th className="p-1 text-left">KPI</th><th className="p-1 text-left">Category</th><th className="p-1">Target</th>
              {QUARTERS.map(([q, ms]) => [...ms.map((m) => <th key={m} className="p-1">{MONTHS[m - 1]}</th>), <th key={q} className="bg-gray-100 p-1">{q}</th>])}
              <th className="bg-gray-200 p-1">YTD</th></tr>
          </thead>
          <tbody>
            {kpis.map((k) => {
              const cell = (months: number[], key: string, strong = false) => {
                const v = ratioFor(parts, k.code, months);
                const st = status(v, Number(k.target_min));
                return <td key={key} className={`p-1 text-center ${CELL[st]} ${strong ? "font-semibold" : ""}`}>{v === null ? "—" : `${v}%`}{strong && v !== null ? ` ${ICON[st]}` : ""}</td>;
              };
              return (
                <tr key={k.code} className="border-t">
                  <td className="p-1" title={k.formula}>{k.name}<span className="ml-1 text-[10px] text-gray-400">{k.source === "auto" ? "auto" : "weekly"}</span></td>
                  <td className="p-1 text-gray-500">{k.category}</td>
                  <td className="p-1 text-center">{k.target_text}</td>
                  {QUARTERS.map(([q, ms]) => [...ms.map((m) => cell([m], `${k.code}${m}`)), cell(ms, `${k.code}${q}`, true)])}
                  {cell([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], `${k.code}ytd`, true)}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-500">✅ on/above target · ❌ below target · — no data yet. Quarter and year figures add up the counts behind each month, so busy weeks count more than quiet ones. Hover a KPI for how it is calculated.</p>

      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">How each KPI is calculated</summary>
        <ul className="mt-2 space-y-1">{kpis.map((k) => <li key={k.code}><b>{k.name}</b> (target {k.target_text}): {k.formula}</li>)}</ul>
        <p className="mt-2 text-xs text-gray-500">“My shifts” = the day/night shifts the engineer checked in for on the On duty page, in the areas they checked in for. CW temp uses the chilled water outlet temperature readings.</p>
      </details>

      {canWrite && (
        <section className="no-print card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Weekly log · week starting {week}</h2>
            <div className="flex gap-2 text-sm">
              <Link href={qs({ week: addDays(week, -7) })} className="btn-secondary px-3 py-1">← Previous week</Link>
              {addDays(week, 7) <= today && <Link href={qs({ week: addDays(week, 7) })} className="btn-secondary px-3 py-1">Next week →</Link>}
            </div>
          </div>
          <ActionForm key={week} action={saveWeeklyLog} submit={thisWeek ? "Update week" : "Save week"} className="space-y-3">
            <input type="hidden" name="staff_ref" value={person.id} /><input type="hidden" name="week_start" value={week} />
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4"><legend className="col-span-full text-xs font-semibold text-gray-700">Safety &amp; HSE</legend>
              {num("gemba_raised", "GEMBA obs raised")}{num("gemba_closed", "GEMBA obs closed")}
              {num("unsafe_observed", "Unsafe acts observed")}{num("unsafe_reported", "Unsafe acts reported")}
              {num("near_miss", "Near-miss reported")}{num("non_routine_jobs", "Non-routine jobs")}
              {num("permits_issued", "Work permits issued")}{num("permits_carried", "Open permits carried over")}
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4"><legend className="col-span-full text-xs font-semibold text-gray-700">Leakage</legend>
              {num("leaks_identified", "Leakages identified")}{num("leaks_closed_24h", "Closed within 24 h")}{num("leaks_escalated", "Escalated")}
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-2 sm:grid-cols-4"><legend className="col-span-full text-xs font-semibold text-gray-700">Digital / THERMAX</legend>
              {num("thermax_callouts", "THERMAX callouts")}{num("thermax_acted", "Acted upon (me)")}{num("thermax_escalated", "Unresolved, escalated")}
            </fieldset>
            <textarea name="notes" rows={2} className="input" placeholder="Remarks / actions taken" defaultValue={thisWeek?.notes ? String(thisWeek.notes) : ""} />
          </ActionForm>
          <p className="text-xs text-gray-500">PM, AMC, availability and quality readings are not entered here: they come from the PM log, AMC tracker, downtime log and equipment registers.</p>
        </section>
      )}

      {logs.length > 0 && (
        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Weekly log history</h2>
          <table className="w-full min-w-[640px] text-xs">
            <thead className="text-left text-gray-500"><tr><th>Week</th><th>GEMBA</th><th>Unsafe acts</th><th>Permits / jobs</th><th>Leaks closed</th><th>THERMAX</th><th>Notes</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.week_start} className="border-t">
                  <td className="py-1"><Link href={qs({ week: l.week_start })} className="text-brand-blue">{l.week_start}</Link></td>
                  <td>{l.gemba_closed ?? "–"}/{l.gemba_raised ?? "–"}</td><td>{l.unsafe_reported ?? "–"}/{l.unsafe_observed ?? "–"}</td>
                  <td>{l.permits_issued ?? "–"}/{l.non_routine_jobs ?? "–"}</td><td>{l.leaks_closed_24h ?? "–"}/{l.leaks_identified ?? "–"}</td>
                  <td>{l.thermax_acted ?? "–"}/{l.thermax_callouts ?? "–"}</td><td className="text-gray-600">{String(l.notes ?? "")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
