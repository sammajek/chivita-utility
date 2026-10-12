import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lagosDate, addDays } from "@/lib/time";
import { WATER_LABEL, WATER_STYLE, type WaterStatus } from "@/lib/water";
import { StatTile } from "@/components/BarList";
import { ActionForm } from "@/components/ActionForm";
import { WaterForm, type Existing, type WaterTest } from "./WaterForm";
import { voidWater } from "./actions";

export const dynamic = "force-dynamic";

interface Row extends WaterTest { sampling_point: string; sample_type: string; sort: number }
interface Result { id: string; test_id: string; sampled_on: string; value_num: number | null; value_text: string | null; status: WaterStatus; comment: string | null; recorded_by_id: string | null; is_demo: boolean }

export default async function WaterPage({ searchParams }: { searchParams: Promise<{ point?: string; date?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const today = lagosDate(new Date());
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;

  const supabase = await createClient();
  const { data: ts } = await supabase.from("water_tests")
    .select("id, sort, sampling_point, sample_type, parameter, unit, frequency, frequency_text, spec_text, spec_min, spec_max, max_inclusive, alert_max, alert_text, method, media, is_text, needs_review")
    .eq("active", true).order("sort");
  const tests = (ts ?? []) as Row[];
  const points = [...new Map(tests.map((t) => [t.sampling_point, t.sample_type])).entries()];
  const point = points.find(([p]) => p === sp.point)?.[0] ?? points[0]?.[0];
  const shown = tests.filter((t) => t.sampling_point === point);

  const from30 = addDays(today, -30);
  const [{ data: rs }, { data: recent }] = await Promise.all([
    supabase.from("water_results").select("id, test_id, sampled_on, value_num, value_text, status, comment, recorded_by_id, is_demo")
      .in("test_id", shown.map((t) => t.id)).gte("sampled_on", addDays(today, -70)).is("voided_at", null).order("sampled_on", { ascending: false }),
    supabase.from("water_results").select("status").gte("sampled_on", from30).is("voided_at", null).limit(10000),
  ]);
  const results = (rs ?? []) as Result[];
  const existing: Record<string, Existing> = Object.fromEntries(results.filter((r) => r.sampled_on === date).map((r) => [r.test_id, r]));
  const judged = (recent ?? []).filter((r) => r.status !== "info");
  const inSpec = judged.filter((r) => r.status === "ok").length;
  const alerts = judged.filter((r) => r.status === "alert").length;
  const actions = judged.filter((r) => r.status === "action").length;
  const dates = [...new Set(results.map((r) => r.sampled_on))].slice(0, 8);
  const canEnter = profile.active && ["operator", "engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const isEngineer = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const href = (o: Record<string, string>) => `/water?${new URLSearchParams({ point: point ?? "", date, ...o })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Water quality</h1>
        <p className="text-sm text-gray-600">Process water sampling plan · CHICQARG24 · results judged against specification and alert limit</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="In spec (30 days)" value={judged.length ? `${Math.round((inSpec / judged.length) * 1000) / 10}%` : "–"} sub={`${inSpec} of ${judged.length} results`} tone="ok" />
        <StatTile label="Alerts" value={String(alerts)} tone={alerts ? "warn" : "default"} />
        <StatTile label="Out of spec" value={String(actions)} tone={actions ? "crit" : "default"} />
        <StatTile label="Sampling points" value={String(points.length)} />
      </div>

      <form className="card grid gap-3 sm:grid-cols-3" action="/water">
        <label className="block sm:col-span-2"><span className="text-xs font-medium text-gray-600">Sampling point</span>
          <select name="point" defaultValue={point} className="input">
            {points.map(([p, s]) => <option key={p} value={p}>{s} · {p}</option>)}
          </select>
        </label>
        <label className="block"><span className="text-xs font-medium text-gray-600">Sample date</span>
          <input type="date" name="date" max={today} defaultValue={date} className="input" /></label>
        <button className="btn-secondary sm:col-span-3">Show</button>
      </form>
      {results.some((r) => r.is_demo) && <p className="text-xs font-semibold text-purple-700">Includes DEMO data</p>}

      <WaterForm key={`${point}-${date}`} tests={shown} existing={existing} sampledOn={date} canEnter={canEnter} />

      {canEnter && results.some((r) => r.sampled_on === date && (isEngineer || r.recorded_by_id === profile.id)) && (
        <details className="card">
          <summary className="cursor-pointer font-medium">Void a result entered by mistake</summary>
          <div className="mt-2 space-y-3">
            {results.filter((r) => r.sampled_on === date && (isEngineer || r.recorded_by_id === profile.id)).map((r) => (
              <ActionForm key={r.id} action={voidWater} submit="Void" className="space-y-1 border-t pt-2 text-sm">
                <input type="hidden" name="id" value={r.id} />
                <div>{shown.find((t) => t.id === r.test_id)?.parameter}: {r.value_num ?? r.value_text}</div>
                <input name="reason" required minLength={5} className="input" placeholder="Reason (required)" />
              </ActionForm>
            ))}
          </div>
        </details>
      )}

      {dates.length > 0 && (
        <div className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Recent results · {point}</h2>
          <table className="w-full min-w-[600px] text-xs">
            <thead><tr className="text-left text-gray-500"><th className="py-1">Parameter</th>{dates.map((d) => <th key={d} className="px-1"><Link className="text-brand-blue" href={href({ date: d })}>{d.slice(5)}</Link></th>)}</tr></thead>
            <tbody>
              {shown.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-1 pr-2">{t.parameter}</td>
                  {dates.map((d) => {
                    const r = results.find((x) => x.test_id === t.id && x.sampled_on === d);
                    return <td key={d} className="px-1">{r ? <span className={`rounded px-1 ${WATER_STYLE[r.status]}`} title={WATER_LABEL[r.status]}>{r.value_num ?? "✓"}</span> : ""}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
