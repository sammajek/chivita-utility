import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { DemoBadge } from "@/components/StatusBadge";
import { FlagActions } from "./FlagActions";

export const dynamic = "force-dynamic";

interface FlagRow {
  id: string;
  kind: string;
  severity: "info" | "warning" | "critical";
  area: string | null;
  title: string;
  detail: string | null;
  raised_at: string;
  escalation_level: number;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  is_demo: boolean;
}

const KIND: Record<string, string> = {
  reading_missing: "Missing reading",
  out_of_spec: "Out of spec",
  critical: "Critical value",
  no_checkin: "No check-in",
  downtime_open: "Downtime open",
  rca_overdue: "RCA overdue",
};
const SEV: Record<string, string> = { critical: "border-l-crit", warning: "border-l-warn", info: "border-l-gray-300" };
const LEVEL = ["Reminder", "Escalated to on-duty engineer", "Escalated to shift manager"];

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const profile = await requireProfile();
  const { show } = await searchParams;
  const closed = show === "closed";
  const supabase = await createClient();
  let q = supabase
    .from("flags")
    .select("id, kind, severity, area, title, detail, raised_at, escalation_level, acknowledged_at, resolved_at, resolution_note, is_demo")
    .order("raised_at", { ascending: false })
    .limit(200);
  q = closed ? q.not("resolved_at", "is", null) : q.is("resolved_at", null);
  const { data } = await q;
  const flags = (data ?? []) as FlagRow[];
  const canResolve = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Flags</h1>
          <p className="text-sm text-gray-600">Raised automatically every 5 minutes: missing or late readings, out-of-spec values, no check-in, open downtime, overdue RCAs.</p>
        </div>
        <Link href={closed ? "/flags" : "/flags?show=closed"} className="text-sm text-brand-blue">{closed ? "Open flags" : "Closed flags"}</Link>
      </div>
      <ul className="space-y-2">
        {flags.map((f) => (
          <li key={f.id} className={`card border-l-4 ${SEV[f.severity]}`}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span className="font-semibold uppercase">{KIND[f.kind] ?? f.kind}{f.area ? ` · ${f.area}` : ""} {f.is_demo && <DemoBadge />}</span>
              <span>{formatLagos(f.raised_at)}</span>
            </div>
            <div className="mt-1 font-medium">{f.title}</div>
            {f.detail && <div className="text-sm text-gray-600">{f.detail}</div>}
            <div className="mt-1 text-xs text-gray-500">
              {f.resolved_at ? `Closed: ${f.resolution_note ?? ""}` : f.acknowledged_at ? "Acknowledged" : LEVEL[f.escalation_level] ?? ""}
            </div>
            {!f.resolved_at && profile.role !== "viewer" && (
              <FlagActions id={f.id} acknowledged={!!f.acknowledged_at} canResolve={canResolve} />
            )}
          </li>
        ))}
        {flags.length === 0 && <li className="card text-sm text-gray-500">No {closed ? "closed" : "open"} flags.</li>}
      </ul>
    </div>
  );
}
