import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { namesFor } from "@/lib/data/pm";
import { formatLagos, SHIFT_LABELS } from "@/lib/time";
import { PreviousHandover } from "./PreviousHandover";

export const dynamic = "force-dynamic";

interface Row {
  id: string; shift_date: string; shift: "day" | "night"; areas: string[]; footnote: string | null; open_flags: number | null;
  recorded_by_id: string; recorded_at: string; received_by: string | null; received_at: string | null; manager_at: string | null; is_demo: boolean;
}

/** Handover notes: every shift's structured handover, who received it and whether a manager signed it. */
export default async function HandoverList() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data }, { data: mine }, { data: legacy }] = await Promise.all([
    supabase.from("handovers").select("id, shift_date, shift, areas, footnote, open_flags, recorded_by_id, recorded_at, received_by, received_at, manager_at, is_demo")
      .order("recorded_at", { ascending: false }).limit(60),
    supabase.from("duty_sessions").select("id").eq("profile_id", profile.id).is("checked_out_at", null).limit(1),
    supabase.from("duty_sessions").select("id, shift_date, shift, handover_note, checked_out_at, profile:profiles(full_name)")
      .not("handover_note", "is", null).order("checked_out_at", { ascending: false }).limit(10),
  ]);
  const rows = (data ?? []) as Row[];
  const names = await namesFor(rows.flatMap((r) => [r.recorded_by_id, r.received_by]));
  const onDuty = (mine ?? []).length > 0;
  const toAck = rows.filter((r) => !r.received_at && !r.is_demo);
  const isMgr = can(profile, "shift_manager_tasks");
  const toSign = isMgr ? rows.filter((r) => !r.manager_at) : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Handover Notes</h1>
          <p className="page-sub">One handover report per shift (Utility Handover Report), written by anyone on duty and acknowledged by anyone on the next shift.</p>
        </div>
        {onDuty
          ? <Link href="/handover/new" className="btn-primary btn-sm">Shift handover &amp; check out</Link>
          : <Link href="/duty" className="btn-secondary btn-sm">Check in first</Link>}
      </div>
      {onDuty && <PreviousHandover profileId={profile.id} />}
      {(toAck.length > 0 || toSign.length > 0) && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">
          {toAck.length > 0 && `${toAck.length} handover(s) not yet acknowledged by the next shift. `}
          {toSign.length > 0 && `${toSign.length} waiting for a manager’s signature.`}
        </p>
      )}
      <div className="table-wrap">
        <table className="data-table min-w-[760px]">
          <thead><tr><th>Shift</th><th>Areas</th><th>Written by</th><th>Acknowledged by</th><th>Manager</th><th className="num">Open flags</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><Link href={`/handover/${r.id}`} className="font-semibold text-brand-blue">{SHIFT_LABELS[r.shift]} · {r.shift_date}</Link>
                  {r.is_demo && <span className="ml-1 rounded bg-purple-100 px-1 text-[10px] font-bold uppercase text-purple-700">Demo</span>}</td>
                <td>{r.areas.join(" + ")}</td>
                <td>{names.get(r.recorded_by_id) ?? "—"}<span className="block text-xs text-gray-500">{formatLagos(r.recorded_at)}</span></td>
                <td>{r.received_at ? <>{names.get(r.received_by ?? "") ?? "—"}<span className="block text-xs text-gray-500">{formatLagos(r.received_at)}</span></> : <span className="text-warn">Not yet</span>}</td>
                <td>{r.manager_at ? <span className="text-ok">✓ Signed</span> : <span className="text-gray-500">Not signed</span>}</td>
                <td className="num">{r.open_flags ?? "–"}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="text-gray-500">No handover reports yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {(legacy ?? []).length > 0 && (
        <details className="card text-sm">
          <summary className="cursor-pointer font-semibold">Earlier Short Handover Notes</summary>
          <ul className="mt-2 space-y-2">
            {((legacy ?? []) as unknown as { id: string; shift_date: string; shift: "day" | "night"; handover_note: string; checked_out_at: string; profile: { full_name: string } | null }[]).map((l) => (
              <li key={l.id}><b>{l.profile?.full_name}</b> · {SHIFT_LABELS[l.shift]} {l.shift_date}<p className="whitespace-pre-line text-gray-700">{l.handover_note}</p></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
