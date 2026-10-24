import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FREQ_LABEL, type PmFrequency } from "@/lib/pm";
import { StateBadge } from "./StateBadge";

export const dynamic = "force-dynamic";

interface Row {
  id: string; code: string; name: string; area: string | null; make: string | null; model: string | null;
  capacity: string | null; criticality: string | null; status: string; pm_code: string | null;
  op_state: string; op_reason: string | null; specs: string | null;
  category: { name: string; sort: number } | null;
  pm_tasks: { frequency: PmFrequency; register_sn: number; active: boolean }[];
}

const FREQ_SHORT: Record<PmFrequency, string> = { daily: "D", weekly: "W", monthly: "M", quarterly: "Q", bi_annual: "6M", annual: "A" };

export default async function EquipmentPage({ searchParams }: { searchParams: Promise<{ q?: string; area?: string; state?: string; csv?: string }> }) {
  await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("assets")
    .select("id, code, name, area, make, model, capacity, criticality, status, pm_code, op_state, op_reason, specs, category:asset_categories(name, sort), pm_tasks(frequency, register_sn, active)")
    .neq("status", "retired")
    .order("code");
  if (sp.area === "U1" || sp.area === "U2") query = query.eq("area", sp.area);
  if (["available", "standby", "unavailable"].includes(sp.state ?? "")) query = query.eq("op_state", sp.state!);
  if (sp.q) query = query.or(`code.ilike.%${sp.q}%,name.ilike.%${sp.q}%,make.ilike.%${sp.q}%,pm_code.ilike.%${sp.q}%`);
  const { data } = await query;
  const rows = ((data ?? []) as unknown as Row[]).sort((a, b) => (a.category?.sort ?? 99) - (b.category?.sort ?? 99) || a.code.localeCompare(b.code));
  const byCat = rows.reduce<Record<string, Row[]>>((acc, r) => ((acc[r.category?.name ?? "Other"] ??= []).push(r), acc), {});
  const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.op_state] = (acc[r.op_state] ?? 0) + 1), acc), {});
  const qs = (o: Record<string, string>) => {
    const p = new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.area ? { area: sp.area } : {}), ...(sp.state ? { state: sp.state } : {}), ...o });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/equipment?${p}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Equipment</h1>
          <p className="text-sm text-gray-600">All Utility equipment with PM code, PM schedule and specifications. Tap a machine to change its state, log running-hours services or add photos.</p>
        </div>
        <a href={`/equipment/csv${qs({}).slice(10)}`} className="btn-secondary">Download CSV</a>
      </div>
      <form className="flex flex-wrap gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Search code, name, make, PM code" className="input max-w-xs py-2" />
        <select name="area" defaultValue={sp.area ?? ""} className="input max-w-[10rem] py-2"><option value="">Both areas</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select>
        <button className="btn-secondary min-h-10">Filter</button>
      </form>
      <div className="flex flex-wrap gap-2 text-sm">
        {[["", "All"], ["available", "Available"], ["standby", "Standby"], ["unavailable", "Unavailable"]].map(([v, l]) => (
          <Link key={v} href={qs({ state: v })} className={`rounded px-2 py-1 ${(sp.state ?? "") === v ? "bg-gray-900 text-white" : "bg-gray-100"}`}>
            {l}{v && counts[v] ? ` (${counts[v]})` : ""}
          </Link>
        ))}
      </div>
      {Object.entries(byCat).map(([cat, list]) => (
        <section key={cat} className="space-y-1">
          <h2 className="font-semibold">{cat} <span className="text-sm font-normal text-gray-500">({list.length})</span></h2>
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs text-gray-500">
                <tr><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Area</th><th className="p-2">Make / model</th>
                  <th className="p-2">Capacity</th><th className="p-2">PM code</th><th className="p-2">PM schedule (S/N)</th><th className="p-2">State</th></tr>
              </thead>
              <tbody>
                {list.map((a) => {
                  const pm = a.pm_tasks.filter((t) => t.active).sort((x, y) => Object.keys(FREQ_SHORT).indexOf(x.frequency) - Object.keys(FREQ_SHORT).indexOf(y.frequency));
                  return (
                    <tr key={a.id} className="border-t align-top">
                      <td className="p-2 font-semibold"><Link href={`/equipment/${encodeURIComponent(a.code)}`} className="text-brand-blue">{a.code}</Link></td>
                      <td className="p-2">{a.name}{a.criticality && <span className="ml-1 text-xs text-gray-500">({a.criticality})</span>}</td>
                      <td className="p-2">{a.area ?? "—"}</td>
                      <td className="p-2">{[a.make, a.model].filter(Boolean).join(" ") || "—"}</td>
                      <td className="p-2">{a.capacity ?? "—"}</td>
                      <td className="p-2">{a.pm_code ?? <span className="text-gray-400">—</span>}</td>
                      <td className="p-2 text-xs">
                        {pm.length ? pm.map((t) => <span key={t.frequency + t.register_sn} title={FREQ_LABEL[t.frequency]} className="mr-1 inline-block rounded bg-gray-100 px-1">{FREQ_SHORT[t.frequency]}{t.register_sn}</span>) : <span className="text-gray-400">no PM</span>}
                      </td>
                      <td className="p-2"><StateBadge state={a.op_state} reason={a.op_reason} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      <p className="text-xs text-gray-500">PM schedule: D = daily, W = weekly, M = monthly, Q = quarterly, 6M = bi-annual, A = annual; the number is the S/N on the PM register (CHIENGUTRG08).</p>
    </div>
  );
}
