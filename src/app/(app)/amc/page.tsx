import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { amcCompletion, amcStatus, MONTHS, type AmcStatus } from "@/lib/amc";
import { lagosDate } from "@/lib/time";
import { StatTile } from "@/components/BarList";
import { ActionForm } from "@/components/ActionForm";
import { DemoBadge } from "@/components/StatusBadge";
import { addContract, recordVisit, togglePlan, voidVisit } from "./actions";

export const dynamic = "force-dynamic";

interface Contract { id: string; sn: number | null; description: string; vendor: string; area: string | null; start_date: string | null; end_date: string | null }
interface Visit { id: string; contract_id: string; month: string; visit_date: string; vendor_rep: string | null; findings: string | null; recommendations: string | null; cost_ngn: number | null; is_demo: boolean }

const CELL: Record<Exclude<AmcStatus, null>, { text: string; cls: string }> = {
  done: { text: "Done", cls: "bg-green-100 text-ok" },
  planned: { text: "Planned", cls: "bg-blue-50 text-brand-blue" },
  past_due: { text: "Past due", cls: "bg-red-100 text-crit font-semibold" },
  extra: { text: "Done (unplanned)", cls: "bg-green-50 text-ok" },
};

export default async function AmcPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const today = lagosDate(new Date());
  const thisYear = Number(today.slice(0, 4));
  const year = Number(sp.year) >= 2023 && Number(sp.year) <= thisYear + 1 ? Number(sp.year) : thisYear;
  const thisMonth = `${today.slice(0, 7)}-01`;
  const months = MONTHS.map((_, i) => `${year}-${String(i + 1).padStart(2, "0")}-01`);
  const isEngineer = profile.active && ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const isManager = profile.active && ["section_manager", "admin"].includes(profile.role);

  const supabase = await createClient();
  const [{ data: cs }, { data: plan }, { data: vs }] = await Promise.all([
    supabase.from("amc_contracts").select("id, sn, description, vendor, area, start_date, end_date").eq("active", true).order("sn"),
    supabase.from("amc_schedule").select("contract_id, month, planned").gte("month", months[0]).lte("month", months[11]),
    supabase.from("amc_visits").select("id, contract_id, month, visit_date, vendor_rep, findings, recommendations, cost_ngn, is_demo")
      .gte("month", months[0]).lte("month", months[11]).is("voided_at", null).order("visit_date", { ascending: false }),
  ]);
  const contracts = (cs ?? []) as Contract[];
  const visits = (vs ?? []) as Visit[];
  const planned = new Set((plan ?? []).filter((p) => p.planned).map((p) => `${p.contract_id}|${p.month}`));
  const visited = new Map(visits.map((v) => [`${v.contract_id}|${v.month}`, v]));
  const cells = contracts.flatMap((c) => months.map((m) => ({ c, month: m, planned: planned.has(`${c.id}|${m}`), visited: visited.has(`${c.id}|${m}`) })));
  const overall = amcCompletion(cells, thisMonth);
  const pastDue = cells.filter((x) => amcStatus(x.planned, x.visited, x.month, thisMonth) === "past_due").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Annual maintenance contracts</h1>
          <p className="text-sm text-gray-600">Utility section AMC {year} · Planned / Done / Past due per month</p>
        </div>
        <div className="flex gap-2 text-sm">
          {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
            <Link key={y} href={`/amc?year=${y}`} className={`rounded px-3 py-1.5 ${y === year ? "bg-gray-900 text-white" : "bg-gray-100"}`}>{y}</Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="AMC completion" value={overall.pct === null ? "–" : `${overall.pct}%`} sub={`${overall.done} of ${overall.due} planned visits (months ended)`}
          tone={overall.pct !== null && overall.pct < 90 ? "warn" : "ok"} />
        <StatTile label="Past due" value={String(pastDue)} tone={pastDue ? "crit" : "default"} />
        <StatTile label="Visits recorded" value={String(visits.length)} />
        <StatTile label="Contracts" value={String(contracts.length)} />
      </div>
      {visits.some((v) => v.is_demo) && <p className="text-xs font-semibold text-purple-700">Includes DEMO data</p>}

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[900px] text-xs">
          <thead>
            <tr className="text-left text-gray-500">
              <th className="py-1 pr-2">AMC</th><th className="pr-2">Vendor</th>
              {MONTHS.map((m) => <th key={m} className="px-0.5 text-center">{m}</th>)}
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.id} className="border-t align-middle">
                <td className="py-2 pr-2 font-medium">{c.description}</td>
                <td className="pr-2">{c.vendor}</td>
                {months.map((m) => {
                  const isPlanned = planned.has(`${c.id}|${m}`);
                  const st = amcStatus(isPlanned, visited.has(`${c.id}|${m}`), m, thisMonth);
                  const cell = st ? CELL[st] : null;
                  return (
                    <td key={m} className="px-0.5 text-center">
                      {isEngineer && !visited.has(`${c.id}|${m}`) ? (
                        <form action={togglePlan}>
                          <input type="hidden" name="contract_id" value={c.id} />
                          <input type="hidden" name="month" value={m} />
                          <input type="hidden" name="planned" value={isPlanned ? "0" : "1"} />
                          <button title={isPlanned ? "Click to unplan" : "Click to plan a visit"}
                            className={`min-h-9 w-full rounded px-1 py-1 ${cell ? cell.cls : "bg-gray-50 text-gray-300 hover:bg-gray-100"}`}>
                            {cell ? cell.text : "+"}
                          </button>
                        </form>
                      ) : (
                        <span className={`block min-h-9 rounded px-1 py-2 ${cell ? cell.cls : ""}`}>{cell?.text ?? ""}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {isEngineer && <p className="mt-2 text-xs text-gray-500">Tap an empty month to plan a visit; tap a planned month to unplan it. A month past its end with no visit shows Past due and raises a flag.</p>}
      </div>

      {isEngineer && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Record a vendor visit</h2>
          <ActionForm action={recordVisit} submit="Save visit" className="grid gap-2 sm:grid-cols-2">
            <select name="contract_id" className="input sm:col-span-2" required>
              {contracts.map((c) => <option key={c.id} value={c.id}>{c.description} · {c.vendor}</option>)}
            </select>
            <label className="block"><span className="text-xs text-gray-600">Visit date</span>
              <input type="date" name="visit_date" max={today} defaultValue={today} className="input" required /></label>
            <label className="block"><span className="text-xs text-gray-600">Vendor engineer</span>
              <input name="vendor_rep" className="input" /></label>
            <textarea name="findings" className="input sm:col-span-2" rows={2} placeholder="Work done / findings" />
            <textarea name="recommendations" className="input sm:col-span-2" rows={2} placeholder="Recommendations / follow-up" />
            <label className="block"><span className="text-xs text-gray-600">Cost (NGN, optional)</span>
              <input name="cost_ngn" inputMode="decimal" className="input" /></label>
          </ActionForm>
        </div>
      )}

      <div className="card">
        <h2 className="mb-2 font-semibold">Visits in {year}</h2>
        {visits.length === 0 ? <p className="text-sm text-gray-500">No visits recorded.</p> : (
          <ul className="divide-y text-sm">
            {visits.map((v) => {
              const c = contracts.find((x) => x.id === v.contract_id);
              return (
                <li key={v.id} className="py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span><b>{v.visit_date}</b> · {c?.description} ({c?.vendor}) {v.is_demo && <DemoBadge />}</span>
                    {v.cost_ngn !== null && <span className="text-xs text-gray-600">₦{Number(v.cost_ngn).toLocaleString()}</span>}
                  </div>
                  {v.vendor_rep && <div className="text-xs text-gray-500">Vendor engineer: {v.vendor_rep}</div>}
                  {v.findings && <div className="text-gray-700">{v.findings}</div>}
                  {v.recommendations && <div className="text-xs text-gray-600">Recommendations: {v.recommendations}</div>}
                  {isEngineer && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-gray-500">Void this visit</summary>
                      <ActionForm action={voidVisit} submit="Void" className="mt-1 flex flex-wrap gap-2">
                        <input type="hidden" name="id" value={v.id} />
                        <input name="reason" required minLength={5} className="input max-w-sm" placeholder="Reason (required)" />
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isManager && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">Add a contract</summary>
          <ActionForm action={addContract} submit="Add contract" className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="description" className="input sm:col-span-2" placeholder="AMC description" required />
            <input name="vendor" className="input" placeholder="Vendor" required />
            <select name="area" className="input" defaultValue="">
              <option value="">Both / factory-wide</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option>
            </select>
            <label className="block"><span className="text-xs text-gray-600">Contract start</span><input type="date" name="start_date" className="input" /></label>
            <label className="block"><span className="text-xs text-gray-600">Contract end</span><input type="date" name="end_date" className="input" /></label>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
