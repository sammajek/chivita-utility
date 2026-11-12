import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DemoBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

interface Row {
  id: string; rca_no: string; problem: string; status: string; target_date: string | null; category_6m: string | null;
  cost_ngn: number | null; is_demo: boolean; asset: { code: string } | null; owner: { full_name: string } | null;
}

export default async function RcaListPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: pending }] = await Promise.all([
    supabase.from("rcas").select("id, rca_no, problem, status, target_date, category_6m, cost_ngn, is_demo, asset:assets(code), owner:profiles!rcas_owner_id_fkey(full_name)")
      .is("voided_at", null).order("created_at", { ascending: false }).limit(200),
    supabase.from("downtime_events").select("id, event_no, rca_reason, asset:assets(code), rcas(id)").eq("rca_required", true).is("voided_at", null).limit(200),
  ]);
  const rows = (data ?? []) as unknown as Row[];
  const awaiting = ((pending ?? []) as unknown as { id: string; event_no: string; rca_reason: string; asset: { code: string }; rcas: { id: string }[] }[])
    .filter((e) => e.rcas.length === 0);
  const today = new Date().toISOString().slice(0, 10);
  const canEdit = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <h1 className="page-title">RCA Log &amp; Analysis</h1>
        {canEdit && <Link href="/rca/new" className="btn-primary">+ New RCA</Link>}
      </div>
      {awaiting.length > 0 && (
        <section className="card border-l-4 border-l-crit">
          <h2 className="font-semibold">Downtime Events Waiting for an RCA ({awaiting.length})</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {awaiting.map((e) => (
              <li key={e.id} className="flex justify-between gap-2">
                <span>{e.event_no} · {e.asset?.code} · <span className="text-gray-500">{e.rca_reason}</span></span>
                {canEdit && <Link href={`/rca/new?downtime=${e.id}`} className="shrink-0 text-brand-blue">Start</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="table-wrap">
        <table className="data-table min-w-[900px]">
          <thead><tr><th>RCA</th><th>Equipment</th><th>Problem</th><th>6M</th><th>Owner</th><th>Target</th><th className="num">Cost (₦)</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const late = r.target_date && r.target_date < today && !r.status.startsWith("Closed");
              return (
                <tr key={r.id}>
                  <td className="code"><Link href={`/rca/${r.id}`} className="text-brand-blue">{r.rca_no}</Link>{r.is_demo && <span className="ml-1"><DemoBadge /></span>}</td>
                  <td className="code">{r.asset?.code ?? "—"}</td>
                  <td className="max-w-md">{r.problem}</td>
                  <td>{r.category_6m ?? "—"}</td>
                  <td>{r.owner?.full_name ?? "—"}</td>
                  <td className={`whitespace-nowrap ${late ? "font-semibold text-crit" : ""}`}>{r.target_date ?? "—"}</td>
                  <td className="num">{r.cost_ngn ? r.cost_ngn.toLocaleString() : "—"}</td>
                  <td>{r.status}</td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="text-gray-500">No RCAs yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
