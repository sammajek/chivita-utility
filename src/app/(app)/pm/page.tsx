import Link from "next/link";
import { requireProfile, can } from "@/lib/auth";
import { loadPmCompletions, loadPmTasks, namesFor, type PmCompletion } from "@/lib/data/pm";
import {
  completedPeriods, FREQ_LABEL, PM_FREQUENCIES, pmAdherence, pmPeriodEnd, pmPeriodLabel, pmPeriodStart,
  RESULT_LABEL, type PmFrequency, CARRIED_OUT, pmName } from "@/lib/pm";
import { logDateOf } from "@/lib/registers";
import { addDays, lagosDate } from "@/lib/time";
import { StatTile } from "@/components/BarList";
import { ActionForm } from "@/components/ActionForm";
import { PmForm } from "./PmForm";
import { checkSpot } from "./actions";
import { affirmPm, voidAffirmation, voidPm } from "./actions";
import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { EvidenceList } from "@/components/EvidenceList";

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
    <div className="flex flex-wrap gap-2">
      {PM_FREQUENCIES.map((f) => (
        <Link key={f} href={href({ freq: f, date: today })}
          className={`tab ${f === freq && view === "log" ? "tab-on" : ""}`}>
          {FREQ_LABEL[f]}
        </Link>
      ))}
      <Link href={href({ view: "schedule" })}
        className={`tab ${view === "schedule" ? "tab-on" : ""}`}>
        Schedule &amp; adherence
      </Link>
      <Link href={`/pm/report?freq=${freq}${area ? `&area=${area}` : ""}`}
        className="tab">
        Report
      </Link>
    </div>
  );
  const areaPicker = (
    <div className="flex gap-2 text-sm">
      {[["", "Both areas"], ["U1", "Utility 1"], ["U2", "Utility 2"]].map(([v, l]) => (
        <Link key={v} href={href({ area: v })} className={`tab ${area === v ? "tab-on" : ""}`}>{l}</Link>
      ))}
    </div>
  );
  const header = (
    <div>
      <h1 className="page-title">Preventive Maintenance</h1>
      <p className="page-sub">Utility PM log · CHIENGUTRG08 · √ Completed – no issue found · X Completed – issue found · P Pending (with a date) · -- Skipped</p>
      <Link href="/pm/hours" className="text-sm text-brand-blue">Running-hours cross-check (compressor services by hours) →</Link>
    </div>
  );

  if (view === "schedule") return <Schedule today={today} area={area} header={header} tabs={tabs} areaPicker={areaPicker} />;

  const tasks = await loadPmTasks(freq, area);
  const completions = await loadPmCompletions(tasks.map((t) => t.id), period, period);
  const existing: Record<string, PmCompletion> = Object.fromEntries(completions.map((c) => [c.task_id, c]));
  const names = Object.fromEntries(await namesFor(completions.map((c) => c.recorded_by_id)));
  const { data: ph } = completions.length
    ? await (await createClient()).from("attachments").select("entity_id").eq("entity_type", "pm_completion").in("entity_id", completions.map((c) => c.id).slice(0, 300))
    : { data: [] };
  const photoIds = ((ph ?? []) as { entity_id: string }[]).map((x) => x.entity_id);
  const canEnter = profile.active && can(profile, "enter_records");
  const isEngineer = can(profile, "engineer_tasks");
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

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Recorded" value={`${completions.length}/${tasks.length}`} />
        <StatTile label={`${RESULT_LABEL.done_ok.code} No issue`} value={String(count("done_ok"))} tone="ok" />
        <StatTile label={`${RESULT_LABEL.done_not_ok.code} Issue found`} value={String(count("done_not_ok"))} tone={count("done_not_ok") ? "crit" : "default"} />
        <StatTile label={`${RESULT_LABEL.pending.code} Pending`} value={String(count("pending"))} tone={count("pending") ? "warn" : "default"} />
        <StatTile label={`${RESULT_LABEL.not_done.code} Skipped`} value={String(count("not_done"))} tone={count("not_done") ? "warn" : "default"} />
      </div>
      {completions.some((c) => c.is_demo) && <p className="text-xs font-semibold text-purple-700">Includes DEMO data</p>}

      <Affirmations freq={freq} period={period} areas={area ? [area] : ["U1", "U2"]} canAffirm={isEngineer && profile.active}
        canWithdraw={can(profile, "manager_tasks")} tasks={tasks} completions={completions} />

      <PmForm key={`${freq}-${period}-${area}`} tasks={tasks} existing={existing} names={names} periodStart={period} canEnter={canEnter} photos={photoIds} />

      {isEngineer && <SpotChecks profileId={profile.id} />}

      {canEnter && completions.some((c) => isEngineer || c.recorded_by_id === profile.id) && (
        <details className="card">
          <summary className="cursor-pointer font-medium">Void a PM Result Entered by Mistake</summary>
          <p className="mt-1 text-xs text-gray-500">The result stays in the audit log with your reason; you can then enter it again.</p>
          <div className="mt-3 space-y-3">
            {completions.filter((c) => isEngineer || c.recorded_by_id === profile.id).map((c) => {
              const t = tasks.find((x) => x.id === c.task_id);
              return (
                <ActionForm key={c.id} action={voidPm} submit="Void" className="space-y-2 border-t pt-3">
                  <input type="hidden" name="id" value={c.id} />
                  <p className="text-sm"><b>{t ? pmName(t.equipment_as_written) : ""}</b>: {RESULT_LABEL[c.result].code} {RESULT_LABEL[c.result].text}</p>
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

/** Engineer / manager sign-off of a PM period, one per area. Counts are frozen when affirmed. */
async function Affirmations({ freq, period, areas, canAffirm, canWithdraw, tasks, completions }: {
  freq: PmFrequency; period: string; areas: string[]; canAffirm: boolean; canWithdraw: boolean;
  tasks: { id: string; area: string }[]; completions: PmCompletion[];
}) {
  const supabase = await createClient();
  const { data } = await supabase.from("pm_affirmations")
    .select("id, area, total_tasks, done_ok, done_not_ok, not_done, not_recorded, note, recorded_by_id, recorded_at, is_demo")
    .eq("frequency", freq).eq("period_start", period).is("voided_at", null);
  const affs = (data ?? []) as { id: string; area: string; total_tasks: number; done_ok: number; done_not_ok: number; not_done: number; not_recorded: number; note: string | null; recorded_by_id: string; recorded_at: string }[];
  const names = await namesFor(affs.map((a) => a.recorded_by_id));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {areas.map((ar) => {
        const a = affs.find((x) => x.area === ar);
        const ids = new Set(tasks.filter((t) => t.area === ar).map((t) => t.id));
        if (!ids.size) return null;
        const got = completions.filter((c) => ids.has(c.task_id));
        const gaps = ids.size - got.filter((c) => c.result === "done_ok").length;
        return (
          <div key={ar} className={`card space-y-2 ${a ? "border-green-300" : ""}`}>
            <div className="flex items-center justify-between"><b>PM affirmation · {ar === "U1" ? "Utility 1" : "Utility 2"}</b>
              {a ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-ok">Affirmed</span> : <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-warn">Not affirmed</span>}</div>
            {a ? (
              <>
                <p className="text-sm">By <b>{names.get(a.recorded_by_id) ?? "—"}</b> on {formatLagos(a.recorded_at)}: {a.done_ok}/{a.total_tasks} √ no issue, {a.done_not_ok} X issue found, {a.not_done} pending or skipped, {a.not_recorded} not recorded.</p>
                {a.note && <p className="text-xs text-gray-600">“{a.note}”</p>}
                <EvidenceList entityType="pm_affirmation" entityId={a.id} canAdd={canAffirm} />
                {canWithdraw && (
                  <details className="text-xs"><summary className="cursor-pointer text-gray-500">Withdraw</summary>
                    <ActionForm action={voidAffirmation} submit="Withdraw" className="mt-1 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={a.id} /><input name="reason" className="input max-w-xs py-1" placeholder="Reason" required minLength={5} />
                    </ActionForm></details>
                )}
              </>
            ) : canAffirm ? (
              <ActionForm action={affirmPm} submit="Affirm PM for this period" className="space-y-2">
                <input type="hidden" name="freq" value={freq} /><input type="hidden" name="area" value={ar} /><input type="hidden" name="period_start" value={period} />
                <p className="text-xs text-gray-600">{got.length}/{ids.size} recorded. {gaps > 0 ? "Some PMs are pending, skipped, have an issue or are not recorded: a note is required." : "All completed with no issue."}</p>
                <input name="note" className="input" placeholder={gaps > 0 ? "Note on what is outstanding *" : "Note (optional)"} required={gaps > 0} minLength={gaps > 0 ? 5 : undefined} />
              </ActionForm>
            ) : <p className="text-xs text-gray-500">An engineer or manager affirms the PM once the period’s work is checked.</p>}
          </div>
        );
      })}
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
      const got = new Set((byTask.get(t.id) ?? []).filter((c) => CARRIED_OUT.includes(c.result)).map((c) => c.period_start));
      done += periods.filter((p) => got.has(p)).length;
    }
    return { f, tasks: ft.length, due, done, pct: pmAdherence(due, done) };
  });
  const totalDue = perFreq.reduce((s, x) => s + x.due, 0);
  const totalDone = perFreq.reduce((s, x) => s + x.done, 0);

  const rows = tasks.map((t) => {
    const cs = (byTask.get(t.id) ?? []).filter((c) => CARRIED_OUT.includes(c.result)).sort((a, b) => b.period_start.localeCompare(a.period_start));
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
        <h2 className="mb-2 font-semibold">Equipment PM: Last Done and Next Due</h2>
        <table className="data-table w-full min-w-[640px] text-sm">
          <thead>
            <tr><th>Equipment</th><th>Frequency</th><th>Last done</th><th>Next due by</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(({ t, last, lastResult, nextDue, overdue }) => (
              <tr key={t.id}>
                <td>
                  {pmName(t.equipment_as_written)}
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

/** This week's random PM spot-checks: an engineer checks the work on site (not their own). */
async function SpotChecks({ profileId }: { profileId: string }) {
  const supabase = await createClient();
  const { data } = await supabase.from("pm_spot_checks")
    .select("id, week_start, area, result, note, checked_by, checked_at, completion:pm_completions(id, recorded_by_id, recorded_at, period_start, task:pm_tasks(equipment_as_written, frequency, asset:assets(code)))")
    .order("week_start", { ascending: false }).limit(30);
  type Row = { id: string; week_start: string; area: string | null; result: string | null; note: string | null; checked_by: string | null; checked_at: string | null;
    completion: { id: string; recorded_by_id: string; recorded_at: string; task: { equipment_as_written: string; frequency: string; asset: { code: string } | null } | null } | null };
  const rows = (data ?? []) as unknown as Row[];
  if (!rows.length) return null;
  const names = await namesFor(rows.flatMap((r) => [r.completion?.recorded_by_id ?? null, r.checked_by]));
  const open = rows.filter((r) => !r.result);
  return (
    <section className="card space-y-3">
      <h2 className="section-title">PM Spot-Checks {open.length > 0 && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-warn">{open.length} to check</span>}</h2>
      <p className="text-xs text-gray-500">Each week a few PMs marked “Completed – no issue found” are picked at random. Go to the machine and check the work. “Not satisfactory” reopens the PM and raises a follow-up.</p>
      <ul className="divide-y">
        {rows.map((r) => {
          const t = r.completion?.task;
          return (
            <li key={r.id} className="space-y-2 py-3 text-sm">
              <p><b>{t ? pmName(t.equipment_as_written) : ""}</b>{t?.asset && <span className="text-gray-500"> ({t.asset.code})</span>} · {t?.frequency.replace("_", "-")} · done by {names.get(r.completion?.recorded_by_id ?? "") ?? "—"} on {r.completion ? formatLagos(r.completion.recorded_at) : "—"} · {r.area} · week of {r.week_start}</p>
              {r.result ? (
                <p className={r.result === "confirmed" ? "text-ok" : "text-crit"}>{r.result === "confirmed" ? "✓ Confirmed" : "✗ Not satisfactory"} by {names.get(r.checked_by ?? "") ?? "—"}{r.note ? `: ${r.note}` : ""}</p>
              ) : r.completion?.recorded_by_id === profileId ? (
                <p className="text-xs text-gray-500">This is your own work: another engineer checks it.</p>
              ) : (
                <ActionForm action={checkSpot} submit="Save check" className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <select name="result" className="input w-auto py-2" required defaultValue="">
                    <option value="" disabled>Result…</option><option value="confirmed">Confirmed on site</option><option value="not_satisfactory">Not satisfactory</option>
                  </select>
                  <input name="note" className="input max-w-md py-2" placeholder="Note (required if not satisfactory)" />
                </ActionForm>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
