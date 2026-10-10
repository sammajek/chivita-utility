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
  rca_reason: string | null; is_demo: boolean; asset: { code: string; name: string } | null; rcas: { id: string; rca_no: string }[];
}

export default async function DowntimePage({ searchParams }: { searchParams: Promise<{ saved?: string; open?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  let q = supabase
    .from("downtime_events")
    .select("id, event_no, start_at, end_at, override_hours, shift, downtime_type, failure_category, failure_mode, status, rca_required, rca_reason, is_demo, asset:assets(code, name), rcas(id, rca_no)")
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
          <h1 className="text-2xl font-bold">Downtime log</h1>
          <Link href={sp.open ? "/downtime" : "/downtime?open=1"} className="text-sm text-brand-blue">{sp.open ? "Show all" : "Open events only"}</Link>
        </div>
        {canLog && <Link href="/downtime/new" className="btn-primary">+ Log downtime</Link>}
      </div>
      {sp.saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">Saved.</p>}
      <ul className="space-y-2">
        {events.map((e) => {
          const hrs = hoursInPeriod(e as never, new Date(0), new Date(8.64e15));
          return (
            <li key={e.id} className="card">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                <span className="font-semibold">{e.event_no} {e.is_demo && <DemoBadge />}</span>
                <span>{formatLagos(e.start_at)} · {e.shift} shift</span>
              </div>
              <div className="mt-1 font-medium">{e.asset?.code} · {e.asset?.name}</div>
              <div className="text-sm text-gray-700">{e.downtime_type} · {e.failure_category} → {e.failure_mode}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${e.status === "Closed" ? "bg-gray-100" : "bg-amber-100 text-warn"}`}>{e.status}</span>
                <span>{hrs.toFixed(2)} h{!e.end_at && " (running)"}</span>
                {e.rca_required && (
                  e.rcas.length ? (
                    <Link href={`/rca/${e.rcas[0].id}`} className="text-xs text-brand-blue">{e.rcas[0].rca_no}</Link>
                  ) : (
                    <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-crit" title={e.rca_reason ?? ""}>RCA required</span>
                  )
                )}
              </div>
              <div className="mt-2 flex gap-3 text-sm">
                {canLog && <Link href={`/downtime/new?id=${e.id}`} className="text-brand-blue">Update</Link>}
                {canRca && e.rca_required && !e.rcas.length && <Link href={`/rca/new?downtime=${e.id}`} className="text-brand-blue">Start RCA</Link>}
              </div>
            </li>
          );
        })}
        {events.length === 0 && <li className="card text-sm text-gray-500">No downtime events.</li>}
      </ul>
    </div>
  );
}
