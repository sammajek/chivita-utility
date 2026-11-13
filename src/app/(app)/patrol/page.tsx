import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { namesFor } from "@/lib/data/pm";
import { formatLagos, SHIFT_LABELS, shiftAt } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { addPoint, removePoint, updatePoint } from "./actions";
import { AreaPicker, LabelButton } from "./Forms";

export const dynamic = "force-dynamic";

const areaName = (p: { area: string | null; area_label: string | null }) => p.area_label ?? (p.area === "U1" ? "Utility 1" : p.area === "U2" ? "Utility 2" : "—");

interface Point { id: string; name: string; area: string | null; area_label: string | null; location: string | null; checks: string[]; rounds_per_shift: number; code_issued_at: string | null; active: boolean }
interface Visit { id: string; point_id: string; shift_date: string; shift: string; issues: number; note: string | null; recorded_by_id: string; recorded_at: string; is_demo: boolean }

/** Area patrols: this shift's rounds per point, recent visits, and (managers) points and their QR labels. */
export default async function PatrolPage() {
  const profile = await requireProfile();
  const cur = shiftAt(new Date());
  const supabase = await createClient();
  const [{ data: pts }, { data: vis }] = await Promise.all([
    supabase.from("patrol_points").select("id, name, area, area_label, location, checks, rounds_per_shift, code_issued_at, active").eq("active", true).order("area").order("name"),
    supabase.from("patrol_visits").select("id, point_id, shift_date, shift, issues, note, recorded_by_id, recorded_at, is_demo").is("voided_at", null)
      .order("recorded_at", { ascending: false }).limit(200),
  ]);
  const points = (pts ?? []) as Point[];
  const visits = (vis ?? []) as Visit[];
  const names = await namesFor(visits.map((v) => v.recorded_by_id));
  const isMgr = can(profile, "shift_manager_tasks");
  const nowVisits = (p: Point) => visits.filter((v) => v.point_id === p.id && v.shift_date === cur.shiftDate && v.shift === cur.shift);
  const done = points.filter((p) => nowVisits(p).length >= p.rounds_per_shift).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Area Patrols</h1>
        <p className="page-sub">Scan the QR label at each patrol point on your round, answer the checks and add a photo if needed. The scan proves the visit. A missed round is flagged after the shift.</p>
      </div>

      <section className="space-y-2">
        <h2 className="section-title">{SHIFT_LABELS[cur.shift]} · {cur.shiftDate}: {done} of {points.length} points done</h2>
        <div className="table-wrap">
          <table className="data-table min-w-[720px]">
            <thead><tr><th>Patrol point</th><th>Area</th><th className="num">Rounds</th><th>This shift</th><th>Last visit</th>{isMgr && <th>Label</th>}</tr></thead>
            <tbody>
              {points.map((p) => {
                const nv = nowVisits(p);
                const last = visits.find((v) => v.point_id === p.id);
                return (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name}{p.location && <span className="block text-xs text-gray-500">{p.location}</span>}</td>
                    <td>{areaName(p)}</td>
                    <td className="num">{nv.length}/{p.rounds_per_shift}</td>
                    <td>{nv.length >= p.rounds_per_shift ? <span className="text-ok">✓ Done</span> : <span className="text-warn">Due</span>}
                      {nv.some((v) => v.issues) && <span className="ml-2 rounded bg-red-100 px-1.5 text-xs font-semibold text-crit">issue reported</span>}</td>
                    <td className="text-xs">{last ? <>{names.get(last.recorded_by_id) ?? "—"} · {formatLagos(last.recorded_at)}</> : "—"}</td>
                    {isMgr && <td>{!p.code_issued_at && <span className="mr-2 text-xs text-warn">no label yet</span>}<LabelButton id={p.id} name={p.name} area={areaName(p)} /></td>}
                  </tr>
                );
              })}
              {points.length === 0 && <tr><td colSpan={6} className="text-gray-500">No patrol points yet.{isMgr ? " Add one below." : ""}</td></tr>}
            </tbody>
          </table>
        </div>
        {isMgr && <p className="text-xs text-gray-500">“Issue code &amp; label” makes a new code: print the label and replace the old one, which stops working.</p>}
      </section>

      <section className="space-y-2">
        <h2 className="section-title">Recent Rounds</h2>
        <div className="table-wrap">
          <table className="data-table min-w-[640px]">
            <thead><tr><th>When</th><th>Point</th><th>By</th><th>Result</th></tr></thead>
            <tbody>
              {visits.slice(0, 40).map((v) => (
                <tr key={v.id}>
                  <td className="whitespace-nowrap">{formatLagos(v.recorded_at)}</td>
                  <td>{points.find((p) => p.id === v.point_id)?.name ?? "—"}</td>
                  <td>{names.get(v.recorded_by_id) ?? "—"}</td>
                  <td>{v.issues ? <span className="text-crit">{v.issues} issue(s): {v.note}</span> : <span className="text-ok">All OK</span>}{v.is_demo && " · DEMO"}</td>
                </tr>
              ))}
              {visits.length === 0 && <tr><td colSpan={4} className="text-gray-500">No rounds recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {isMgr && points.length > 0 && (
        <details className="card">
          <summary className="cursor-pointer section-title">Edit or Remove Patrol Points</summary>
          <div className="mt-3 divide-y">
            {points.map((p) => (
              <div key={p.id} className="space-y-2 py-3">
                <ActionForm action={updatePoint} submit="Save changes" className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="id" value={p.id} />
                  <input name="name" required minLength={3} defaultValue={p.name} className="input" />
                  <input name="location" defaultValue={p.location ?? ""} placeholder="Where exactly (optional)" className="input" />
                  <AreaPicker area={p.area} label={p.area_label} />
                  <label className="text-sm">Rounds per shift <input name="rounds" type="number" min={1} max={12} defaultValue={p.rounds_per_shift} className="input" /></label>
                  <textarea name="checks" rows={3} defaultValue={p.checks.join("\n")} className="input sm:col-span-2" />
                </ActionForm>
                <ActionForm action={removePoint} submit={`Remove “${p.name}”`} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={p.id} />
                  <span className="text-xs text-gray-500">Its label stops working; past rounds stay on record.</span>
                </ActionForm>
              </div>
            ))}
          </div>
        </details>
      )}

      {isMgr && (
        <details className="card">
          <summary className="cursor-pointer section-title">Add a Patrol Point</summary>
          <ActionForm action={addPoint} submit="Add patrol point" className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="name" required minLength={3} className="input" placeholder="Name (e.g. Borehole field, Cooling tower area)" />
            <input name="location" className="input" placeholder="Where exactly (optional)" />
            <AreaPicker />
            <label className="text-sm">Rounds per shift <input name="rounds" type="number" min={1} max={12} defaultValue={1} className="input" /></label>
            <textarea name="checks" rows={4} className="input sm:col-span-2" placeholder={"Checks, one per line (leave empty for the standard three):\nNo leaks (water, steam, air, oil)\nNo abnormal noise, vibration or smell\nArea clean, safe and secure"} />
          </ActionForm>
        </details>
      )}
    </div>
  );
}
