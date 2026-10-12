import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lagosDate } from "@/lib/time";
import { calibrationState, type CalState } from "@/lib/water";
import { StatTile } from "@/components/BarList";
import { ActionForm } from "@/components/ActionForm";
import { DemoBadge } from "@/components/StatusBadge";
import { recordCalibration, saveInstrument, voidCalibration } from "./actions";

export const dynamic = "force-dynamic";

const TYPES = ["Pressure gauge", "Safety relief valve", "Flowmeter", "Temperature transmitter", "Pressure transmitter", "Level transmitter", "Analyser", "Energy meter", "Other"];
const STATE: Record<CalState, { text: string; cls: string }> = {
  overdue: { text: "Overdue", cls: "bg-red-100 text-crit" },
  due_soon: { text: "Due soon", cls: "bg-amber-100 text-warn" },
  ok: { text: "In date", cls: "bg-green-100 text-ok" },
  unknown: { text: "No date", cls: "bg-gray-100 text-gray-600" },
};

interface Instrument {
  id: string; tag: string; description: string; instrument_type: string; asset_id: string | null; area: string | null;
  location: string | null; range_text: string | null; interval_months: number; last_calibrated: string | null;
  next_due: string | null; notes: string | null; is_demo: boolean;
}
interface Cal { id: string; instrument_id: string; calibrated_on: string; result: string; certificate_no: string | null; vendor: string | null; notes: string | null }

export default async function CalibrationPage() {
  const profile = await requireProfile();
  const today = lagosDate(new Date());
  const supabase = await createClient();
  const [{ data: ins }, { data: cals }, { data: assets }, { data: warn }] = await Promise.all([
    supabase.from("instruments").select("id, tag, description, instrument_type, asset_id, area, location, range_text, interval_months, last_calibrated, next_due, notes, is_demo").eq("active", true).order("next_due", { nullsFirst: true }),
    supabase.from("calibrations").select("id, instrument_id, calibrated_on, result, certificate_no, vendor, notes").is("voided_at", null).order("calibrated_on", { ascending: false }).limit(500),
    supabase.from("assets").select("id, code, name").order("code"),
    supabase.from("app_settings").select("value").eq("key", "calibration_warn_days").maybeSingle(),
  ]);
  const warnDays = Number(warn?.value ?? 30);
  const instruments = (ins ?? []) as Instrument[];
  const history = (cals ?? []) as Cal[];
  const withState = instruments.map((i) => ({ i, st: calibrationState(i.next_due, today, warnDays) }));
  const count = (s: CalState) => withState.filter((x) => x.st === s).length;
  const order: CalState[] = ["overdue", "due_soon", "unknown", "ok"];
  withState.sort((a, b) => order.indexOf(a.st) - order.indexOf(b.st) || (a.i.next_due ?? "").localeCompare(b.i.next_due ?? ""));
  const canEdit = profile.active && ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const inDate = instruments.length ? Math.round(((count("ok") + count("due_soon")) / instruments.length) * 1000) / 10 : null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Instrument calibration</h1>
        <p className="text-sm text-gray-600">Calibration register: next due = last calibration + interval. Flags {warnDays} days before the due date.</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="In date" value={inDate === null ? "–" : `${inDate}%`} sub={`${count("ok") + count("due_soon")} of ${instruments.length}`} tone="ok" />
        <StatTile label="Overdue" value={String(count("overdue"))} tone={count("overdue") ? "crit" : "default"} />
        <StatTile label={`Due in ${warnDays} days`} value={String(count("due_soon"))} tone={count("due_soon") ? "warn" : "default"} />
        <StatTile label="No date yet" value={String(count("unknown"))} />
      </div>
      {instruments.some((i) => i.is_demo) && (
        <p className="text-xs font-semibold text-purple-700">The instruments tagged DEMO- are examples. Add your real instrument list below (or send it to be imported).</p>
      )}

      <div className="space-y-2">
        {withState.map(({ i, st }) => (
          <details key={i.id} className="card">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{i.tag} · {i.description} {i.is_demo && <DemoBadge />}</span>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${STATE[st].cls}`}>{STATE[st].text}</span>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-gray-600">
                <span>{i.instrument_type}</span>
                {i.location && <span>{i.location}</span>}
                {i.range_text && <span>{i.range_text}</span>}
                <span>Every {i.interval_months} months</span>
                <span>Last: {i.last_calibrated ?? "—"}</span>
                <span className={st === "overdue" ? "font-semibold text-crit" : ""}>Next due: {i.next_due ?? "—"}</span>
              </div>
            </summary>
            <div className="mt-3 space-y-3 border-t pt-3">
              {history.filter((c) => c.instrument_id === i.id).length > 0 && (
                <ul className="space-y-1 text-sm">
                  {history.filter((c) => c.instrument_id === i.id).map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>{c.calibrated_on} · <b className={c.result === "fail" ? "text-crit" : ""}>{c.result}</b>{c.certificate_no && ` · ${c.certificate_no}`}{c.vendor && ` · ${c.vendor}`}{c.notes && <span className="text-gray-600"> · {c.notes}</span>}</span>
                      {canEdit && (
                        <details className="text-xs"><summary className="cursor-pointer text-gray-500">Void</summary>
                          <ActionForm action={voidCalibration} submit="Void" className="mt-1 flex gap-2">
                            <input type="hidden" name="id" value={c.id} />
                            <input name="reason" required minLength={5} className="input" placeholder="Reason" />
                          </ActionForm>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canEdit && (
                <ActionForm action={recordCalibration} submit="Record calibration" className="grid gap-2 sm:grid-cols-3">
                  <input type="hidden" name="instrument_id" value={i.id} />
                  <label className="block"><span className="text-xs text-gray-600">Calibrated on</span><input type="date" name="calibrated_on" max={today} defaultValue={today} required className="input" /></label>
                  <label className="block"><span className="text-xs text-gray-600">Result</span>
                    <select name="result" className="input"><option value="pass">Pass</option><option value="adjusted">Adjusted, then pass</option><option value="fail">Fail (remove / replace)</option></select></label>
                  <label className="block"><span className="text-xs text-gray-600">Certificate no.</span><input name="certificate_no" className="input" /></label>
                  <label className="block"><span className="text-xs text-gray-600">Vendor</span><input name="vendor" className="input" /></label>
                  <label className="block sm:col-span-2"><span className="text-xs text-gray-600">Notes</span><input name="notes" className="input" /></label>
                </ActionForm>
              )}
            </div>
          </details>
        ))}
      </div>

      {canEdit && (
        <details className="card">
          <summary className="cursor-pointer font-semibold">+ Add an instrument</summary>
          <ActionForm action={saveInstrument} submit="Add instrument" className="mt-3 grid gap-2 sm:grid-cols-3">
            <input name="tag" required className="input" placeholder="Tag (e.g. PG-BLR01-01)" />
            <input name="description" required className="input sm:col-span-2" placeholder="Description" />
            <select name="instrument_type" className="input">{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
            <select name="asset_id" className="input" defaultValue=""><option value="">Equipment (optional)</option>{(assets ?? []).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select>
            <select name="area" className="input" defaultValue="U1"><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select>
            <input name="location" className="input" placeholder="Location" />
            <input name="range_text" className="input" placeholder="Range / set point" />
            <label className="block"><span className="text-xs text-gray-600">Interval (months)</span><input name="interval_months" type="number" min={1} max={120} defaultValue={12} className="input" /></label>
            <label className="block"><span className="text-xs text-gray-600">Last calibrated (if known)</span><input type="date" name="last_calibrated" max={today} className="input" /></label>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
