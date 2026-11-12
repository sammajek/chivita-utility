import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { hoursInPeriod } from "@/lib/kpi";
import { DemoBadge } from "@/components/StatusBadge";

export const dynamic = "force-dynamic";

interface Ev {
  id: string; event_no: string; start_at: string; end_at: string | null; override_hours: number | null; shift: string;
  downtime_type: string; failure_category: string; failure_mode: string; status: string; rca_required: boolean;
  rca_reason: string | null; followup_stage: string | null; is_demo: boolean; asset: { code: string; name: string } | null; rcas: { id: string; rca_no: string }[];
}

const FU_LABEL: Record<string, string> = { containment: "Contained", further_action: "Further action", resolved: "Resolved" };
const FU_STYLE: Record<string, string> = {
  containment: "bg-amber-100 text-warn", further_action: "bg-blue-100 text-brand-blue", resolved: "bg-green-100 text-ok",
};

export default async function DowntimePage({ searchParams }: { searchParams: Promise<{ saved?: string; open?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("downtime_events")
    .select("id, event_no, start_at, end_at, override_hours, shift, downtime_type, failure_category, failure_mode, status, rca_required, rca_reason, followup_stage, is_demo, asset:assets(code, name), rcas(id, rca_no)")
    .is("voided_at", null)
    .order("start_at", { ascending: false })
    .limit(200);
  if (sp.open) q = q.neq("status", "Closed");
  const { data } = await q;
  const events = (data ?? []) as unknown as Ev[];
  const canLog = profile.role !== "viewer" && profile.active;
  const canRca = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="page-title">Downtime Log &amp; Analysis</h1>
          <Link href={sp.open ? "/downtime" : "/downtime?open=1"} className="text-sm text-brand-blue">{sp.open ? "Show all" : "Open events only"}</Link>
        </div>
        {canLog && <Link href="/downtime/new" className="btn-primary">+ Log downtime</Link>}
      </div>
      {sp.saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">Saved.</p>}
      <div className="table-wrap">
        <table className="data-table min-w-[960px]">
          <thead><tr><th>Event</th><th>Start</th><th>Equipment</th><th>Type / failure</th><th className="num">Hours</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {events.map((e) => {
              const hrs = hoursInPeriod(e as never, new Date(0), new Date(8.64e15));
              return (
                <tr key={e.id}>
                  <td className="code"><Link href={`/downtime/${e.id}`} className="text-brand-blue">{e.event_no}</Link>{e.is_demo && <span className="ml-1"><DemoBadge /></span>}</td>
                  <td className="whitespace-nowrap">{formatLagos(e.start_at)}<span className="block text-xs text-gray-500">{e.shift} shift</span></td>
                  <td><b>{e.asset?.code}</b><span className="block text-xs text-gray-500">{e.asset?.name}</span></td>
                  <td>{e.downtime_type}<span className="block text-xs text-gray-500">{e.failure_category} → {e.failure_mode}</span></td>
                  <td className="num">{hrs.toFixed(2)}{!e.end_at && <span className="block text-xs text-warn">running</span>}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${e.status === "Closed" ? "bg-gray-100" : "bg-amber-100 text-warn"}`}>{e.status}</span>
                      {e.followup_stage && <span className={`rounded px-2 py-0.5 text-xs font-semibold ${FU_STYLE[e.followup_stage]}`}>{FU_LABEL[e.followup_stage]}</span>}
                      {e.rca_required && (e.rcas.length
                        ? <Link href={`/rca/${e.rcas[0].id}`} className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-brand-blue">{e.rcas[0].rca_no}</Link>
                        : <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-crit" title={e.rca_reason ?? ""}>RCA required</span>)}
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-sm">
                    <Link href={`/downtime/${e.id}`} className="font-semibold text-brand-blue">Follow up</Link>
                    {canLog && <><span className="text-gray-300"> · </span><Link href={`/downtime/new?id=${e.id}`} className="text-brand-blue">Update</Link></>}
                    {canRca && e.rca_required && !e.rcas.length && <><span className="text-gray-300"> · </span><Link href={`/rca/new?downtime=${e.id}`} className="text-brand-blue">Start RCA</Link></>}
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && <tr><td colSpan={7} className="text-gray-500">No downtime events.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
