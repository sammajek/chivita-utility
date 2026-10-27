import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addDays, lagosDate } from "@/lib/time";
import { StatTile } from "@/components/BarList";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { MeterForm, type MeterRow } from "./MeterForm";
import { dailyUseByMeter, monthDays } from "@/lib/consumption";

export const dynamic = "force-dynamic";

const GROUPS = [
  ["daily", "7 A.M. report"], ["water", "Water flowmeters"], ["energy", "Energy meters"], ["borehole", "Boreholes"], ["condensate", "Condensate"],
] as const;
type Group = (typeof GROUPS)[number][0];

interface Meter { id: string; code: string; name: string; grp: Group; unit: string | null; kind: MeterRow["kind"]; sort: number; asset: { code: string } | null }
interface Usage { meter_id: string; kind: string; read_date: string; value: number; used: number | null; days: number; is_reset: boolean; comment: string | null; is_demo: boolean }

export default async function ConsumptionPage({ searchParams }: { searchParams: Promise<{ g?: string; date?: string; view?: string; month?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const grp: Group = (GROUPS.map((g) => g[0]) as string[]).includes(sp.g ?? "") ? (sp.g as Group) : "daily";
  const today = lagosDate(new Date());
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const report = sp.view === "report";
  const supabase = await createClient();
  const { data: mdata } = await supabase.from("meters").select("id, code, name, grp, unit, kind, sort, asset:assets(code)").eq("active", true).order("sort");
  const meters = (mdata ?? []) as unknown as Meter[];
  const canEnter = profile.active && profile.role !== "viewer";
  const tab = (g: string, label: string, on: boolean, href: string) => (
    <Link key={g} href={href} className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium ${on ? "border-brand-red bg-brand-red text-white" : "border-gray-300 bg-white"}`}>{label}</Link>
  );
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold">Utility consumption</h1>
        <p className="text-sm text-gray-600">7A.M Daily Utility Consumption Report · read every meter at 07:00. Daily use = today’s reading − the previous reading.</p>
      </div>
      <Logo height={32} />
    </div>
  );
  const tabs = (
    <div className="no-print flex gap-2 overflow-x-auto pb-1">
      {GROUPS.map(([g, l]) => tab(g, l, !report && g === grp, `/consumption?g=${g}&date=${date}`))}
      {tab("report", "Monthly report", report, `/consumption?view=report&g=${grp}`)}
    </div>
  );

  if (report) return <Report />;

  const list = meters.filter((m) => m.grp === grp);
  const ids = list.map((m) => m.id);
  const [{ data: todays }, { data: prevs }] = await Promise.all([
    supabase.from("meter_usage").select("meter_id, kind, read_date, value, used, days, is_reset, comment, is_demo").in("meter_id", ids).eq("read_date", date),
    supabase.from("meter_readings").select("meter_id, read_date, value").in("meter_id", ids).lt("read_date", date).gte("read_date", addDays(date, -60))
      .is("voided_at", null).order("read_date", { ascending: false }),
  ]);
  const prevBy = new Map<string, { date: string; value: number }>();
  for (const p of prevs ?? []) if (!prevBy.has(p.meter_id)) prevBy.set(p.meter_id, { date: p.read_date, value: Number(p.value) });
  const todayBy = new Map(((todays ?? []) as Usage[]).map((u) => [u.meter_id, u]));
  const rows: MeterRow[] = list.map((m) => {
    const t = todayBy.get(m.id);
    return { id: m.id, code: m.code, name: m.name, unit: m.unit, kind: m.kind, prev: prevBy.get(m.id) ?? null,
             today: t ? { value: Number(t.value), used: t.used === null ? null : Number(t.used), is_reset: t.is_reset, comment: t.comment } : null };
  });
  const done = rows.filter((r) => r.today).length;

  return (
    <div className="space-y-4">
      {header}
      {tabs}
      <form className="card flex flex-wrap items-center justify-between gap-3">
        <input type="hidden" name="g" value={grp} />
        <label className="flex items-center gap-2 text-sm">Reading date (07:00)
          <input type="date" name="date" defaultValue={date} max={today} className="input w-44 py-2" />
          <button className="btn-secondary min-h-10">Go</button></label>
        <span className="text-sm text-gray-600">{done}/{rows.length} entered</span>
      </form>
      <MeterForm key={`${grp}-${date}`} date={date} meters={rows} canEnter={canEnter} />
    </div>
  );

  async function Report() {
    const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
    const days = monthDays(month);
    const { data } = await supabase.from("meter_usage").select("meter_id, kind, read_date, value, used, days, is_reset, comment, is_demo")
      .gte("read_date", days[0]).lte("read_date", days[days.length - 1]).limit(10000);
    const usage = (data ?? []) as Usage[];
    const byMeter = dailyUseByMeter(usage);
    const sum = (code: string) => { const m = meters.find((x) => x.code === code); return m ? byMeter.get(m.id)?.total ?? 0 : 0; };
    const lines = meters.filter((m) => /^W-L\d+$/.test(m.code)).reduce((s, m) => s + (byMeter.get(m.id)?.total ?? 0), 0);
    const wtp = sum("W-WTP");
    const prevMonth = lagosDate(new Date(Date.parse(`${month}-01T12:00:00Z`) - 15 * 86_400_000)).slice(0, 7);
    const nextMonth = lagosDate(new Date(Date.parse(`${month}-01T12:00:00Z`) + 45 * 86_400_000)).slice(0, 7);
    const ratio = (a: number, b: number) => (a > 0 && b > 0 ? (a / b).toLocaleString("en-GB", { maximumFractionDigits: 3 }) : "–");

    return (
      <div className="space-y-4">
        {header}
        {tabs}
        <div className="card flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link href={`/consumption?view=report&month=${prevMonth}`} className="btn-secondary px-3 py-2 text-sm">←</Link>
            <b>{new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b>
            {nextMonth <= today.slice(0, 7) && <Link href={`/consumption?view=report&month=${nextMonth}`} className="btn-secondary px-3 py-2 text-sm">→</Link>}
          </div>
          <div className="flex gap-2">
            <a href={`/consumption/csv?month=${month}`} className="btn-secondary">Download CSV</a>
            <PrintButton />
          </div>
        </div>
        {usage.some((u) => u.is_demo) && <p className="text-xs font-semibold text-purple-700">Includes DEMO data</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Boiler 1 gas per m³ steam" value={ratio(sum("B1-GAS"), sum("B1-STM"))} sub={`${Math.round(sum("B1-GAS")).toLocaleString()} m³ gas`} />
          <StatTile label="Boiler 2 gas per m³ steam" value={ratio(sum("B2-GAS"), sum("B2-STM"))} sub={`${Math.round(sum("B2-GAS")).toLocaleString()} m³ gas`} />
          <StatTile label="Boiler 4 gas per t steam" value={ratio(sum("B4-GAS"), sum("B4-STM"))} sub={`${Math.round(sum("B4-GAS")).toLocaleString()} m³ gas`} />
          <StatTile label="Water: lines ÷ WTP output" value={wtp > 0 ? `${Math.round((lines / wtp) * 100)}%` : "–"}
            sub={`${Math.round(lines).toLocaleString()} of ${Math.round(wtp).toLocaleString()} m³`} />
        </div>
        <p className="text-xs text-gray-500">Gas per steam uses the boiler’s own gas and steam totalisers for the month. Lines ÷ WTP shows how much treated water reaches the metered lines (the rest is backwash, unmetered use or losses). More KPIs (kWh per m³ air, kWh/TR, water per unit product) need production and air-flow figures: tell me where those come from.</p>

        {GROUPS.map(([g, label]) => {
          const ms = meters.filter((m) => m.grp === g);
          return (
            <section key={g} className="space-y-1 break-inside-avoid">
              <h2 className="font-semibold">{label}</h2>
              <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr><th className="sticky left-0 bg-gray-50 p-1 text-left">Meter</th><th className="p-1">Unit</th><th className="p-1">Total</th>
                      {days.map((d) => <th key={d} className="p-1">{Number(d.slice(8))}</th>)}</tr>
                  </thead>
                  <tbody>
                    {ms.map((m) => {
                      const u = byMeter.get(m.id);
                      return (
                        <tr key={m.id} className="border-t">
                          <td className="sticky left-0 whitespace-nowrap bg-white p-1">{m.name}</td>
                          <td className="p-1 text-center text-gray-500">{m.unit ?? ""}</td>
                          <td className="p-1 text-right font-semibold">{u && m.kind !== "rate" ? Math.round(u.total).toLocaleString() : m.kind === "rate" && u?.avg != null ? `avg ${Math.round(u.avg).toLocaleString()}` : ""}</td>
                          {days.map((d) => {
                            const x = u?.byDay.get(d);
                            return <td key={d} className={`p-1 text-right ${x?.reset ? "bg-amber-50" : ""}`} title={x?.comment ?? ""}>{x?.v != null ? Math.round(x.v).toLocaleString() : ""}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        <p className="text-xs text-gray-500">Each day shows the use since the previous reading (rates show the value read). Shaded = meter reset or replaced. If a day was missed, the next reading’s use covers both days.</p>
      </div>
    );
  }
}
