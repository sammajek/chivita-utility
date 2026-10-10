import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { loadPmCompletions, loadPmTasks, namesFor, type PmCompletion } from "@/lib/data/pm";
import {
  completedPeriods, FREQ_LABEL, PM_FREQUENCIES, pmAdherence, pmPeriodEnd, pmPeriodLabel, pmPeriodStart,
  RESULT_LABEL, type PmFrequency,
} from "@/lib/pm";
import { logDateOf } from "@/lib/registers";
import { addDays, lagosDate } from "@/lib/time";
import { StatTile } from "@/components/BarList";
import { ActionForm } from "@/components/ActionForm";
import { PmForm } from "./PmForm";
import { voidPm } from "./actions";

export const dynamic = "force-dynamic";

type Search = { freq?: string; date?: string; area?: string; view?: string };

export default async function PmPage({ searchParams }: { searchParams: Promise<Search> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const freq: PmFrequency = (PM_FREQUENCIES as readonly string[]).includes(sp.freq ?? "") ? (sp.freq as PmFrequency) : "daily";
  const today = logDateOf(new Date());
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) && sp.date <= today ? sp.date : today;
  const area = sp.area === "U1" || sp.area === "U2" ? sp.area : "";
  const view = sp.view === "schedule" ? "schedule" : "log";
  const period = pmPeriodStart(freq, date);
  const prev = pmPeriodStart(freq, addDays(period, -1));
  const next = pmPeriodEnd(freq, period);

  const href = (o: Partial<Search>) => {
    const q = new URLSearchParams({ freq, date: period, ...(area ? { area } : {}), view, ...o });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    return `/pm?${q}`;
  };

  const tabs = (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {PM_FREQUENCIES.map((f) => (
        <Link key={f} href={href({ freq: f, date: today })}
          className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium ${f === freq && view === "log" ? "border-brand-red bg-brand-red text-white" : "border-gray-300 bg-white"}`}>
          {FREQ_LABEL[f]}
        </Link>
      ))}
      <Link href={href({ view: "schedule" })}
        className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium ${view === "schedule" ? "border-brand-blue bg-brand-blue text-white" : "border-gray-300 bg-white"}`}>
        Schedule &amp; adherence
      </Link>
    </div>
  );
  const areaPicker = (
    <div className="flex gap-2 text-sm">
      {[["", "Both areas"], ["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
        <Link key={v} href={href({ area: v })} className={`rounded px-2 py-1 ${area === v ? "bg-gray-900 text-white" : "bg-gray-100"}`}>{l}</Link>
      ))}
    </div>
  );
  const header = (
    <div>
      <h1 className="text-xl font-bold">Preventive maintenance</h1>
      <p className="text-sm text-gray-600">Utility PM log · CHIENGUTRG08 · Done OK “√”, Not done “--”, Done not OK “X”</p>
    </div>
  );

  if (view === "schedule") return <Schedule today={today} area={area} header={header} tabs={tabs} areaPicker={areaPicker} />;

  const tasks = await loadPmTasks(freq, area);
  const completions = await loadPmCompletions(tasks.map((t) => t.id), period, period);
  const existing: Record<string, PmCompletion> = Object.fromEntries(completions.map((c) => [c.task_id, c]));
  const names = Object.fromEntries(await namesFor(completions.map((c) => c.recorded_by_id)));
  const canEnter = profile.active && ["operator", "engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const isEngineer = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const count = (r: string) => completions.filter((c) => c.result === r).length;
  const ended = next <= today;

  return (
    <div className="space-y-4">
      {header}
      {tabs}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={href({ date: prev })} className="btn-secondary px-3 py-2 text-sm" aria-label="Previous period">←</Link>
          <div className="text-center">
            <div className="font-semibold">{pmPeriodLabel(freq, period)}</div>
            <div className="text-xs text-gray-500">{ended ? "Period ended" : "Current period"}</div>
          </div>
          {next <= today ? (
            <Link href={href({ date: next })} className="btn-secondary px-3 py-2 text-sm" aria-label="Next period">→</Link>
          ) : (
            <span className="px-3 py-2 text-sm text-gray-300">→</span>
          )}
        </div>
        {areaPicker}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Recorded" value={`${completions.length}/${tasks.length}`} />
        <StatTile label={`${RESULT_LABEL.done_ok.code} Done OK`} value={String(count("done_ok"))} tone="ok" />
        <StatTile label={`${RESULT_LABEL.done_not_ok.code} Not OK`} value={String(count("done_not_ok"))} tone={count("done_not_ok") ? "crit" : "default"} />
        <StatTile label={`${RESULT_LABEL.not_done.code} Not done`} value={String(count("not_done"))} tone={count("not_done") ? "warn" : "default"} />
      </div>
      {completions.some((c) => c.is_demo) && <p className="text-xs font-semibold text-purple-700">Includes DEMO data</p>}

      <PmForm key={`${freq}-${period}-${area}`} tasks={tasks} existing={existing} names={names} periodStart={period} canEnter={canEnter} />

      {canEnter && completions.some((c) => isEngineer || c.recorded_by_id === profile.id) && (
        <details className="card">
          <summary className="cursor-pointer font-medium">Void a PM result entered by mistake</summary>
          <p className="mt-1 text-xs text-gray-500">The result stays in the audit log with your reason; you can then enter it again.</p>
          <div className="mt-3 space-y-3">
            {completions.filter((c) => isEngineer || c.recorded_by_id === profile.id).map((c) => {
              const t = tasks.find((x) => x.id === c.task_id);
              return (
                <ActionForm key={c.id} action={voidPm} submit="Void" className="space-y-2 border-t pt-3">
                  <input type="hidden" name="id" value={c.id} />
                  <p className="text-sm"><b>{t?.equipment_as_written}</b>: {RESULT_LABEL[c.result].code} {RESULT_LABEL[c.result].text}</p>
                  <input name="reason" required minLength={5} className="input" placeholder="Reason (required)" />
                </ActionForm>
              );
            })}
          </div>
        </details>
      )}
    </div>
  );
}

async function Schedule({ today, area, header, tabs, areaPicker }: {
  today: string; area: string; header: React.ReactNode; tabs: React.ReactNode; areaPicker: React.ReactNode;
}) {
  const tasks = await loadPmTasks(undefined, area);
  const from = addDays(today, -90);
  // earliest period start that can matter for last-done dates
  const completions = await loadPmCompletions(tasks.map((t) => t.id), addDays(today, -400));
  const byTask = new Map<string, PmCompletion[]>();
  for (const c of completions) byTask.set(c.task_id, [...(byTask.get(c.task_id) ?? []), c]);

  const perFreq = PM_FREQUENCIES.map((f) => {
    const ft = tasks.filter((t) => t.frequency === f);
    let due = 0, done = 0;
    for (const t of ft) {
      const periods = completedPeriods(f, from, today);
      due += periods.length;
      const got = new Set((byTask.get(t.id) ?? []).filter((c) => c.result !== "not_done").map((c) => c.period_start));
      done += periods.filter((p) => got.has(p)).length;
    }
    return { f, tasks: ft.length, due, done, pct: pmAdherence(due, done) };
  });
  const totalDue = perFreq.reduce((s, x) => s + x.due, 0);
  const totalDone = perFreq.reduce((s, x) => s + x.done, 0);

  const rows = tasks.map((t) => {
    const cs = (byTask.get(t.id) ?? []).filter((c) => c.result !== "not_done").sort((a, b) => b.period_start.localeCompare(a.period_start));
    const current = pmPeriodStart(t.frequency, today);
    const prevStart = pmPeriodStart(t.frequency, addDays(current, -1));
    const doneNow = cs.some((c) => c.period_start === current);
    const donePrev = cs.some((c) => c.period_start === prevStart);
    const nextDue = doneNow ? pmPeriodEnd(t.frequency, pmPeriodEnd(t.frequency, current)) : pmPeriodEnd(t.frequency, current);
    return { t, last: cs[0]?.recorded_at ?? null, lastResult: cs[0]?.result, nextDue: addDays(nextDue, -1), overdue: !donePrev && !doneNow };
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.nextDue.localeCompare(b.nextDue));

  return (
    <div className="space-y-4">
      {header}
      {tabs}
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-semibold">PM adherence, last 90 days</div>
          <div className="text-xs text-gray-500">PMs carried out (√ or X) ÷ PMs due, for periods that have ended. “--” and blanks count as missed.</div>
        </div>
        {areaPicker}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Overall" value={pmAdherence(totalDue, totalDone) === null ? "–" : `${pmAdherence(totalDue, totalDone)}%`}
          sub={`${totalDone} of ${totalDue}`} tone={(pmAdherence(totalDue, totalDone) ?? 100) < 90 ? "warn" : "ok"} />
        {perFreq.filter((x) => x.due > 0).map((x) => (
          <StatTile key={x.f} label={FREQ_LABEL[x.f]} value={x.pct === null ? "–" : `${x.pct}%`} sub={`${x.done} of ${x.due} · ${x.tasks} tasks`} />
        ))}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Equipment PM: last done and next due</h2>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs text-gray-500">
            <tr><th className="py-1">Equipment</th><th>Frequency</th><th>Last done</th><th>Next due by</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ t, last, lastResult, nextDue, overdue }) => (
              <tr key={t.id} className="border-t align-top">
                <td className="py-1.5">
                  {t.equipment_as_written.replace(/\.$/, "")}
                  {t.asset && <span className="ml-1 text-xs text-gray-500">({t.asset.code})</span>}
                  {t.hours_interval && <div className="text-xs text-gray-500">{t.hours_interval.toLocaleString()} h service</div>}
                </td>
                <td>{FREQ_LABEL[t.frequency]}</td>
                <td>{last ? `${lagosDate(new Date(last))}${lastResult === "done_not_ok" ? " (X)" : ""}` : "—"}</td>
                <td className={overdue ? "font-semibold text-crit" : ""}>{nextDue}</td>
                <td>{overdue && <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-crit">Overdue</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
