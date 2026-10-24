import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { hoursInPeriod } from "@/lib/kpi";
import { namesFor } from "@/lib/data/pm";
import { ActionForm } from "@/components/ActionForm";
import { DemoBadge } from "@/components/StatusBadge";
import { EvidenceList } from "@/components/EvidenceList";
import { completeFollowup, voidFollowup } from "../actions";
import { FollowupForm, STAGE_LABEL } from "./FollowupForm";

export const dynamic = "force-dynamic";

interface Followup {
  id: string; stage: string; note: string; action_owner: string | null; target_date: string | null;
  completed_at: string | null; completion_note: string | null; recorded_by_id: string | null; recorded_at: string;
}

const STAGE_STYLE: Record<string, string> = {
  containment: "bg-amber-100 text-warn", further_action: "bg-blue-100 text-brand-blue", resolved: "bg-green-100 text-ok",
};

export default async function DowntimeDetail({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data: ev } = await supabase
    .from("downtime_events")
    .select("*, asset:assets(code, name, op_state, op_reason), rcas(id, rca_no)")
    .eq("id", id).maybeSingle();
  if (!ev) notFound();
  const e = ev as Record<string, unknown> & {
    event_no: string; start_at: string; end_at: string | null; override_hours: number | null; status: string;
    followup_stage: string | null; is_demo: boolean; recorded_by_id: string | null;
    asset: { code: string; name: string; op_state: string; op_reason: string | null } | null; rcas: { id: string; rca_no: string }[];
  };
  const { data: fu } = await supabase.from("downtime_followups")
    .select("id, stage, note, action_owner, target_date, completed_at, completion_note, recorded_by_id, recorded_at")
    .eq("downtime_id", id).is("voided_at", null).order("recorded_at");
  const followups = (fu ?? []) as Followup[];
  const names = await namesFor([e.recorded_by_id, ...followups.map((f) => f.recorded_by_id)]);
  const canAct = profile.active && profile.role !== "viewer";
  const isEng = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const hrs = hoursInPeriod(e as never, new Date(0), new Date(8.64e15));
  const today = new Date().toISOString().slice(0, 10);

  const row = (l: string, v: unknown) => v ? <div><dt className="text-xs text-gray-500">{l}</dt><dd className="text-sm">{String(v)}</dd></div> : null;

  return (
    <div className="space-y-4">
      <Link href="/downtime" className="text-sm text-brand-blue">← Downtime log</Link>
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold">{e.event_no} {e.is_demo && <DemoBadge />}</h1>
          <div className="flex gap-2 text-xs">
            <span className={`rounded px-2 py-0.5 font-semibold ${e.status === "Closed" ? "bg-gray-100" : "bg-amber-100 text-warn"}`}>{e.status}</span>
            {e.followup_stage && <span className={`rounded px-2 py-0.5 font-semibold ${STAGE_STYLE[e.followup_stage]}`}>{STAGE_LABEL[e.followup_stage]}</span>}
          </div>
        </div>
        <div className="font-medium">{e.asset?.code} · {e.asset?.name}</div>
        <dl className="grid gap-2 sm:grid-cols-3">
          {row("Start", formatLagos(e.start_at))}
          {row("End", e.end_at ? formatLagos(e.end_at) : "Still down")}
          {row("Hours", `${hrs.toFixed(2)} h${e.override_hours != null ? " (override)" : ""}`)}
          {row("Downtime type", e.downtime_type)}
          {row("Failure", `${e.failure_category} → ${e.failure_mode}`)}
          {row("Issue", e.issue_description)}
          {row("Immediate action", e.immediate_action)}
          {row("Spares used", e.spares_used)}
          {row("Attended by", e.attended_by)}
          {row("Impact on production", e.production_impact)}
          {row("Remarks", e.remarks)}
          {row("Logged by", names.get(e.recorded_by_id ?? "") ?? "—")}
          {row("Equipment now", e.asset ? `${e.asset.op_state}${e.asset.op_reason ? ` (${e.asset.op_reason})` : ""}` : null)}
        </dl>
        <div className="flex flex-wrap gap-3 text-sm">
          {canAct && <Link href={`/downtime/new?id=${id}`} className="text-brand-blue">Update event</Link>}
          {e.rcas[0] && <Link href={`/rca/${e.rcas[0].id}`} className="text-brand-blue">{e.rcas[0].rca_no}</Link>}
        </div>
      </div>

      <section className="card space-y-2">
        <h2 className="font-semibold">Photos &amp; documents</h2>
        <EvidenceList entityType="downtime" entityId={id} canAdd={canAct} />
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Follow-up</h2>
        {followups.length === 0 && <p className="card text-sm text-gray-500">No follow-up yet.</p>}
        <ol className="space-y-2">
          {followups.map((f) => {
            const overdue = f.stage === "further_action" && !f.completed_at && f.target_date && f.target_date < today;
            return (
              <li key={f.id} className={`card space-y-1 ${overdue ? "border-red-300" : ""}`}>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className={`rounded px-2 py-0.5 font-semibold ${STAGE_STYLE[f.stage]}`}>{STAGE_LABEL[f.stage]}</span>
                  <span className="text-gray-500">{formatLagos(f.recorded_at)} · {names.get(f.recorded_by_id ?? "") ?? "—"}</span>
                </div>
                <p className="text-sm">{f.note}</p>
                {f.stage === "further_action" && (
                  <p className="text-xs text-gray-600">
                    By <b>{f.action_owner}</b> · target {f.target_date}
                    {f.completed_at ? <> · <span className="text-ok">done {formatLagos(f.completed_at)}: {f.completion_note}</span></> : overdue ? <span className="text-crit"> · overdue</span> : null}
                  </p>
                )}
                <EvidenceList entityType="followup" entityId={f.id} canAdd={canAct} />
                {f.stage === "further_action" && !f.completed_at && canAct && (
                  <ActionForm action={completeFollowup} className="flex flex-wrap items-center gap-2" submit="Mark done">
                    <input type="hidden" name="id" value={f.id} /><input type="hidden" name="downtime_id" value={id} />
                    <input name="note" className="input max-w-sm py-2" placeholder="What was done" required minLength={3} />
                  </ActionForm>
                )}
                {isEng && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-500">Void</summary>
                    <ActionForm action={voidFollowup} className="mt-1 flex flex-wrap items-center gap-2" submit="Void">
                      <input type="hidden" name="id" value={f.id} /><input type="hidden" name="downtime_id" value={id} />
                      <input name="reason" className="input max-w-sm py-2" placeholder="Reason" required minLength={5} />
                    </ActionForm>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
        {canAct && e.followup_stage !== "resolved" && <FollowupForm downtimeId={id} canResolve={isEng} hasEnd={!!e.end_at} />}
      </section>
    </div>
  );
}
