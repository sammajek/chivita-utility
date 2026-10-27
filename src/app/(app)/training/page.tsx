import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos, lagosDate } from "@/lib/time";
import { namesFor } from "@/lib/data/pm";
import { ActionForm } from "@/components/ActionForm";
import { StatTile } from "@/components/BarList";
import { EvidenceList } from "@/components/EvidenceList";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { addTraining, setTrainingStatus, voidTraining } from "./actions";

export const dynamic = "force-dynamic";

interface Plan {
  id: string; fy: string; planned_text: string | null; planned_start: string | null; planned_end: string | null;
  provider: string | null; status: string; completed_on: string | null; outcome_note: string | null;
  confirmed_by: string | null; confirmed_at: string | null; is_demo: boolean;
  staff: { id: string; staff_id: string; full_name: string; band: number | null } | null;
  course: { id: string; title: string; duration: string | null } | null;
}

const TRAINING_STATUS: Record<string, { label: string; style: string }> = {
  planned: { label: "Planned", style: "bg-gray-100 text-gray-700" },
  completed: { label: "✓ Done", style: "bg-green-100 text-ok" },
  not_attended: { label: "Not attended", style: "bg-red-100 text-crit" },
  postponed: { label: "Postponed", style: "bg-amber-100 text-warn" },
  cancelled: { label: "Cancelled", style: "bg-gray-200 text-gray-600" },
};

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ fy?: string; view?: string; status?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const fy = sp.fy ?? "FY2026";
  const byCourse = sp.view === "course";
  const supabase = await createClient();
  const [{ data }, { data: staffData }, { data: courseData }] = await Promise.all([
    supabase.from("training_plans")
      .select("id, fy, planned_text, planned_start, planned_end, provider, status, completed_on, outcome_note, confirmed_by, confirmed_at, is_demo, staff:staff(id, staff_id, full_name, band), course:training_courses(id, title, duration)")
      .eq("fy", fy).is("voided_at", null).order("planned_start"),
    supabase.from("staff").select("id, full_name, staff_id").eq("active", true).order("first_name"),
    supabase.from("training_courses").select("id, title").eq("active", true).order("title"),
  ]);
  let plans = (data ?? []) as unknown as Plan[];
  const all = plans;
  if (sp.status && TRAINING_STATUS[sp.status]) plans = plans.filter((p) => p.status === sp.status);
  const names = await namesFor(plans.map((p) => p.confirmed_by));
  const isEng = profile.active && ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const isMgr = ["section_manager", "admin"].includes(profile.role);
  const today = lagosDate(new Date());
  const done = all.filter((p) => p.status === "completed").length;
  const due = all.filter((p) => p.planned_end && p.planned_end < today && p.status !== "cancelled").length;
  const doneOfDue = all.filter((p) => p.planned_end && p.planned_end < today && p.status === "completed").length;

  const groups = new Map<string, Plan[]>();
  for (const p of plans) {
    const k = byCourse ? p.course?.title ?? "—" : `${p.staff?.full_name ?? "—"} · ${p.staff?.staff_id ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  const keys = [...groups.keys()].sort();
  const link = (o: Record<string, string>) => `/training?${new URLSearchParams({ fy, ...(byCourse ? { view: "course" } : {}), ...(sp.status ? { status: sp.status } : {}), ...o })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Training needs · {fy}</h1>
          <p className="text-sm text-gray-600">Training Needs for Utility Section. Engineers and managers tick each training when it has been done and can attach the certificate.</p>
          <PrintButton />
        </div>
        <Logo height={36} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Trainings planned" value={String(all.length)} sub={`${new Set(all.map((p) => p.staff?.id)).size} people · ${new Set(all.map((p) => p.course?.id)).size} courses`} />
        <StatTile label="Done" value={String(done)} tone="ok" />
        <StatTile label="Completion (past dates)" value={due ? `${Math.round((doneOfDue / due) * 100)}%` : "–"} sub={`${doneOfDue} of ${due} whose dates have passed`} />
        <StatTile label="Past date, not ticked" value={String(all.filter((p) => p.status === "planned" && p.planned_end && p.planned_end < today).length)}
          tone={all.some((p) => p.status === "planned" && p.planned_end && p.planned_end < today) ? "warn" : "default"} />
      </div>
      <div className="no-print flex flex-wrap gap-2 text-sm">
        <Link href={link({ view: byCourse ? "" : "course" })} className="rounded bg-gray-900 px-2 py-1 text-white">{byCourse ? "Group by person" : "Group by course"}</Link>
        {[["", "All"], ...Object.entries(TRAINING_STATUS).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <Link key={k} href={link({ status: k })} className={`rounded px-2 py-1 ${(sp.status ?? "") === k ? "bg-brand-blue text-white" : "bg-gray-100"}`}>{l}</Link>
        ))}
      </div>

      {keys.map((k) => (
        <section key={k} className="card space-y-2 break-inside-avoid">
          <h2 className="font-semibold">{k}</h2>
          <ul className="divide-y">
            {groups.get(k)!.map((p) => {
              const st = TRAINING_STATUS[p.status];
              const pastDue = p.status === "planned" && p.planned_end && p.planned_end < today;
              return (
                <li key={p.id} className="space-y-1 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm">
                      <b>{byCourse ? p.staff?.full_name : p.course?.title}</b>
                      <span className="block text-xs text-gray-500">{p.planned_text ?? "date not set"} · {p.course?.duration ?? ""} · {p.provider ?? ""}</span>
                    </div>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${pastDue ? "bg-amber-100 text-warn" : st.style}`}>{pastDue ? "Past date – not ticked" : st.label}</span>
                  </div>
                  {p.status !== "planned" && (
                    <p className="text-xs text-gray-600">{p.completed_on ? `Completed ${p.completed_on}. ` : ""}{p.outcome_note ?? ""} — {names.get(p.confirmed_by ?? "") ?? "—"}{p.confirmed_at ? `, ${formatLagos(p.confirmed_at)}` : ""}</p>
                  )}
                  <EvidenceList entityType="training" entityId={p.id} canAdd={isEng} />
                  {isEng && (
                    <details className="no-print text-sm">
                      <summary className="cursor-pointer text-brand-blue">{p.status === "planned" ? "Tick done / update" : "Change"}</summary>
                      <ActionForm action={setTrainingStatus} className="mt-2 flex flex-wrap items-end gap-2">
                        <input type="hidden" name="id" value={p.id} />
                        <select name="status" defaultValue={p.status === "planned" ? "completed" : p.status} className="input w-44 py-2">
                          {Object.entries(TRAINING_STATUS).map(([v, x]) => <option key={v} value={v}>{x.label}</option>)}
                        </select>
                        <label className="text-xs">Date completed<input type="date" name="date" max={today} defaultValue={p.completed_on ?? (p.planned_end && p.planned_end <= today ? p.planned_end : today)} className="input py-2" /></label>
                        <input name="note" className="input max-w-xs py-2" placeholder="Note (required unless done)" defaultValue={p.outcome_note ?? ""} />
                      </ActionForm>
                      {isMgr && (
                        <ActionForm action={voidTraining} submit="Remove" className="mt-2 flex flex-wrap gap-2">
                          <input type="hidden" name="id" value={p.id} />
                          <input name="reason" className="input max-w-xs py-2" placeholder="Reason for removing" required minLength={5} />
                        </ActionForm>
                      )}
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {keys.length === 0 && <p className="card text-sm text-gray-500">No training records.</p>}

      {isEng && (
        <section className="no-print card space-y-2">
          <h2 className="font-semibold">Add a training need</h2>
          <ActionForm action={addTraining} submit="Add" className="grid gap-2 sm:grid-cols-2">
            <input type="hidden" name="fy" value={fy} />
            <select name="staff_ref" className="input py-2" required defaultValue="">
              <option value="" disabled>Person…</option>
              {(staffData ?? []).map((s) => <option key={s.id} value={s.id}>{s.full_name} ({s.staff_id})</option>)}
            </select>
            <select name="course_id" className="input py-2" defaultValue="">
              <option value="">New course (type below)…</option>
              {(courseData ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <input name="new_course" className="input py-2 sm:col-span-2" placeholder="New course title (if not in the list)" />
            <input name="provider" className="input py-2" placeholder="Training provider" />
            <input name="duration" className="input py-2" placeholder="Duration (e.g. 5 Days)" />
            <label className="text-xs">Start<input type="date" name="start" className="input py-2" /></label>
            <label className="text-xs">End<input type="date" name="end" className="input py-2" /></label>
          </ActionForm>
        </section>
      )}
      <p className="text-xs text-gray-500">Competency assessment will be added here when the template is ready.</p>
    </div>
  );
}
