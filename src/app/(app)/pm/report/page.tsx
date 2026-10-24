import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadPmCompletions, loadPmTasks, namesFor } from "@/lib/data/pm";
import { FREQ_LABEL, PM_FREQUENCIES, pmAdherence, pmPeriodEnd, pmPeriodLabel, pmPeriodStart, RESULT_LABEL, type PmFrequency } from "@/lib/pm";
import { logDateOf } from "@/lib/registers";
import { addDays, formatLagos } from "@/lib/time";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";

export const dynamic = "force-dynamic";

type Search = { freq?: string; from?: string; to?: string; area?: string };
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** PM report: per period and area — recorded, √ / X / --, adherence, affirmation; then every exception with its note. */
export default async function PmReport({ searchParams }: { searchParams: Promise<Search> }) {
  await requireProfile();
  const sp = await searchParams;
  const today = logDateOf(new Date());
  const freqs: PmFrequency[] = (PM_FREQUENCIES as readonly string[]).includes(sp.freq ?? "") ? [sp.freq as PmFrequency] : [...PM_FREQUENCIES];
  const to = isDate(sp.to) && sp.to! <= today ? sp.to! : today;
  const from = isDate(sp.from) && sp.from! <= to ? sp.from! : addDays(to, -90);
  const area = sp.area === "U1" || sp.area === "U2" ? sp.area : "";
  const areas = area ? [area] : ["U1", "U2"];

  const tasks = (await loadPmTasks(undefined, area)).filter((t) => freqs.includes(t.frequency));
  const completions = await loadPmCompletions(tasks.map((t) => t.id), pmPeriodStart("annual", from), to);
  const supabase = await createClient();
  const { data: affData } = await supabase.from("pm_affirmations")
    .select("frequency, area, period_start, recorded_by_id, recorded_at, note")
    .in("frequency", freqs).gte("period_start", pmPeriodStart("annual", from)).lte("period_start", to).is("voided_at", null);
  const affs = (affData ?? []) as { frequency: string; area: string; period_start: string; recorded_by_id: string; recorded_at: string; note: string | null }[];
  const names = await namesFor([...affs.map((a) => a.recorded_by_id), ...completions.map((c) => c.recorded_by_id)]);
  const byKey = new Map(completions.map((c) => [`${c.task_id}|${c.period_start}`, c]));

  const sections = freqs.map((f) => {
    const ft = tasks.filter((t) => t.frequency === f);
    const periods: string[] = [];
    for (let p = pmPeriodStart(f, from); p <= to; p = pmPeriodEnd(f, p)) periods.push(p);
    const rows = periods.flatMap((p) => areas.map((ar) => {
      const at = ft.filter((t) => t.area === ar);
      const cs = at.map((t) => byKey.get(`${t.id}|${p}`)).filter(Boolean);
      const ok = cs.filter((c) => c!.result === "done_ok").length;
      const nok = cs.filter((c) => c!.result === "done_not_ok").length;
      const nd = cs.filter((c) => c!.result === "not_done").length;
      const ended = pmPeriodEnd(f, p) <= today;
      const aff = affs.find((a) => a.frequency === f && a.area === ar && a.period_start === p);
      return { p, ar, total: at.length, ok, nok, nd, blank: at.length - cs.length, ended, pct: ended ? pmAdherence(at.length, ok + nok) : null, aff };
    })).filter((r) => r.total > 0);
    const due = rows.filter((r) => r.ended).reduce((s, r) => s + r.total, 0);
    const done = rows.filter((r) => r.ended).reduce((s, r) => s + r.ok + r.nok, 0);
    return { f, rows, pct: pmAdherence(due, done), due, done, affirmed: rows.filter((r) => r.ended && r.aff).length, endedRows: rows.filter((r) => r.ended).length };
  }).filter((s) => s.rows.length);

  const exceptions = completions
    .filter((c) => c.result !== "done_ok" && c.period_start >= pmPeriodStart("annual", from))
    .map((c) => ({ c, t: tasks.find((t) => t.id === c.task_id)! }))
    .filter((x) => x.t && x.c.period_start >= pmPeriodStart(x.t.frequency, from))
    .sort((a, b) => b.c.period_start.localeCompare(a.c.period_start));

  const qs = (o: Partial<Search>) => {
    const p = new URLSearchParams({ ...(sp.freq ? { freq: sp.freq } : {}), from, to, ...(area ? { area } : {}), ...o } as Record<string, string>);
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/pm/report?${p}`;
  };

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-center gap-2">
        <Link href="/pm" className="text-sm text-brand-blue">← PM</Link>
      </div>
      <form className="no-print card flex flex-wrap items-end gap-2">
        <label className="text-xs">Frequency<select name="freq" defaultValue={sp.freq ?? ""} className="input py-2"><option value="">All</option>{PM_FREQUENCIES.map((f) => <option key={f} value={f}>{FREQ_LABEL[f]}</option>)}</select></label>
        <label className="text-xs">From<input type="date" name="from" defaultValue={from} className="input py-2" /></label>
        <label className="text-xs">To<input type="date" name="to" defaultValue={to} max={today} className="input py-2" /></label>
        <label className="text-xs">Area<select name="area" defaultValue={area} className="input py-2"><option value="">Both</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select></label>
        <button className="btn-secondary min-h-10">Show</button>
        <Link href={qs({ from: addDays(today, -30), to: today })} className="text-sm text-brand-blue">Last 30 days</Link>
      </form>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Preventive maintenance report</h1>
          <p className="text-sm text-gray-600">CHIENGUTRG08 · {from} to {to} · {area ? (area === "U1" ? "Utility 1" : "Utility 2") : "Utility 1 & 2"}</p>
          <p className="text-xs text-gray-500">Generated {formatLagos(new Date())}. Adherence = PMs carried out (√ or X) ÷ PMs due, for periods that have ended.</p>
          <PrintButton />
        </div>
        <Logo height={40} />
      </div>

      <table className="w-full text-sm">
        <thead className="text-left text-xs text-gray-500"><tr><th>Frequency</th><th>Adherence</th><th>Carried out / due</th><th>Periods affirmed</th></tr></thead>
        <tbody>
          {sections.map((s) => (
            <tr key={s.f} className="border-t"><td className="py-1">{FREQ_LABEL[s.f]}</td>
              <td className={(s.pct ?? 100) < 90 ? "font-semibold text-warn" : "font-semibold text-ok"}>{s.pct === null ? "–" : `${s.pct}%`}</td>
              <td>{s.done} / {s.due}</td><td>{s.affirmed} / {s.endedRows}</td></tr>
          ))}
        </tbody>
      </table>

      {sections.map((s) => (
        <section key={s.f} className="space-y-1 break-inside-avoid">
          <h2 className="font-semibold">{FREQ_LABEL[s.f]}</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr><th className="py-1">Period</th><th>Area</th><th>Tasks</th><th>√</th><th>X</th><th>--</th><th>Blank</th><th>Adherence</th><th>Affirmed by</th></tr>
              </thead>
              <tbody>
                {s.rows.map((r) => (
                  <tr key={r.p + r.ar} className="border-t">
                    <td className="py-1">{pmPeriodLabel(s.f, r.p)}{!r.ended && <span className="text-xs text-gray-500"> (current)</span>}</td>
                    <td>{r.ar}</td><td>{r.total}</td><td>{r.ok}</td><td className={r.nok ? "text-crit" : ""}>{r.nok}</td>
                    <td className={r.nd ? "text-warn" : ""}>{r.nd}</td><td className={r.blank && r.ended ? "text-warn" : ""}>{r.blank}</td>
                    <td>{r.pct === null ? "–" : `${r.pct}%`}</td>
                    <td className="text-xs">{r.aff ? `${names.get(r.aff.recorded_by_id) ?? "—"} · ${formatLagos(r.aff.recorded_at)}` : r.ended ? <span className="text-warn">not affirmed</span> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section className="space-y-1">
        <h2 className="font-semibold">Exceptions: not done (--) and done not OK (X)</h2>
        {exceptions.length === 0 && <p className="text-sm text-gray-500">None in this period.</p>}
        <table className="w-full text-sm">
          <tbody>
            {exceptions.map(({ c, t }) => (
              <tr key={c.id} className="border-t align-top">
                <td className="py-1 pr-2 whitespace-nowrap">{pmPeriodLabel(t.frequency, c.period_start)}</td>
                <td className="pr-2">{t.equipment_as_written.replace(/\.$/, "")}{t.asset ? ` (${t.asset.code})` : ""}</td>
                <td className="pr-2 font-semibold">{RESULT_LABEL[c.result].code}</td>
                <td className="pr-2">{c.note}</td>
                <td className="text-xs text-gray-500">{names.get(c.recorded_by_id ?? "") ?? "—"}{c.is_demo ? " · DEMO" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
