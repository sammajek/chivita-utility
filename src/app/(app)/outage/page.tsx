import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos, lagosDate, lagosParts } from "@/lib/time";
import { namesFor } from "@/lib/data/pm";
import { ActionForm } from "@/components/ActionForm";
import { EvidenceList } from "@/components/EvidenceList";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { declareOutage, endOutage } from "./actions";

export const dynamic = "force-dynamic";

interface Outage {
  id: string; started_at: string; ended_at: string | null; reason: string; end_note: string | null;
  recorded_by_id: string | null; ended_by: string | null;
}

const hhmm = (d: Date) => { const p = lagosParts(d); return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`; };

/** What to do when the app or the internet is down: paper sheets, then back-entry. */
export default async function OutagePage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const [{ data: outs }, { data: regs }, { data: setting }] = await Promise.all([
    supabase.from("system_outages").select("id, started_at, ended_at, reason, end_note, recorded_by_id, ended_by").order("started_at", { ascending: false }).limit(20),
    supabase.from("registers").select("key, title, document_no, area").order("area").order("title"),
    supabase.from("app_settings").select("value").eq("key", "outage_backfill_hours").maybeSingle(),
  ]);
  const outages = (outs ?? []) as Outage[];
  const open = outages.find((o) => !o.ended_at);
  const names = await namesFor(outages.flatMap((o) => [o.recorded_by_id, o.ended_by]));
  const isEng = profile.active && ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const backfill = Number(setting?.value ?? 24);
  const now = new Date();

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Outage response plan</h1>
          <p className="text-sm text-gray-600">What to do when the app or the internet is down. Print this page and keep it in each control room with a stock of blank sheets.</p>
          <PrintButton />
        </div>
        <Logo height={36} />
      </div>

      {open ? (
        <div className="card space-y-2 border-red-300 bg-red-50">
          <b className="text-crit">Outage in progress since {formatLagos(open.started_at)}</b>
          <p className="text-sm">{open.reason} — declared by {names.get(open.recorded_by_id ?? "") ?? "—"}. Missing-reading flags are paused.</p>
          <EvidenceList entityType="outage" entityId={open.id} canAdd={profile.active && profile.role !== "viewer"} />
          {isEng && (
            <ActionForm action={endOutage} submit="End outage" className="no-print flex flex-wrap items-end gap-2">
              <input type="hidden" name="id" value={open.id} />
              <label className="text-xs">Back since<input type="date" name="date" defaultValue={lagosDate(now)} className="input py-2" /></label>
              <input type="time" name="time" defaultValue={hhmm(now)} className="input w-32 py-2" />
              <input name="note" className="input max-w-xs py-2" placeholder="Cause / what fixed it" />
            </ActionForm>
          )}
        </div>
      ) : isEng ? (
        <div className="no-print card space-y-2">
          <b>Declare an outage</b>
          <p className="text-xs text-gray-600">Do this as soon as anyone can get online (from any phone or PC); set the time it actually started. It pauses missing-reading flags so nobody is escalated for slots logged on paper.</p>
          <ActionForm action={declareOutage} submit="Declare outage" className="flex flex-wrap items-end gap-2">
            <input name="reason" className="input max-w-sm py-2" placeholder="What is down (e.g. internet at Utility 1, app not loading)" required minLength={3} />
            <label className="text-xs">Started<input type="date" name="date" defaultValue={lagosDate(now)} className="input py-2" /></label>
            <input type="time" name="time" defaultValue={hhmm(now)} className="input w-32 py-2" />
          </ActionForm>
        </div>
      ) : null}

      <section className="card space-y-2 text-sm">
        <h2 className="font-semibold">Steps</h2>
        <ol className="list-decimal space-y-2 pl-5">
          <li><b>Check it is an outage.</b> Try another phone or network (mobile data vs Wi-Fi). If only one phone fails, use another device. If a reading is typed but will not save, it is kept on that phone: press Save again when the network returns.</li>
          <li><b>Tell the on-duty engineer.</b> The engineer informs IT and, if the outage lasts more than 30 minutes, the shift manager. The engineer (or anyone who can get online) <b>declares the outage</b> here with the real start time.</li>
          <li><b>Log on paper.</b> Use the blank sheets below (same parameters, standards and slots as the app). Write the <b>actual time</b> of each reading and your initials. Out-of-spec values: act and escalate by phone as normal; write the action in the margin.</li>
          <li><b>Critical values and breakdowns</b> do not wait for the app: phone the on-duty engineer / shift manager immediately. Record downtime on paper (equipment, start/end time, failure, action, attended by).</li>
          <li><b>When it is back:</b> the engineer ends the outage. Within <b>{backfill} hours</b>, operators enter every paper value in the app for its slot and tick <b>“Entered from a paper sheet”</b>. Downtime, PM and other records are entered with their real times.</li>
          <li><b>Evidence:</b> photograph each paper sheet and attach it to the outage record above; file the originals.</li>
          <li>After {backfill} hours, any slot still empty is flagged as missing as usual. The outage stays in the history for audit and compliance reports (paper readings are marked “paper”).</li>
        </ol>
        <p className="text-xs text-gray-500">The app needs only a browser and a mobile connection; it is hosted in the cloud, not on site. A plant power cut does not stop it if phones have data.</p>
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Blank paper sheets</h2>
        <p className="text-xs text-gray-600">Open and print. Multi-machine registers print the first machine; choose another on the sheet page.</p>
        <ul className="grid gap-1 text-sm sm:grid-cols-2">
          {(regs ?? []).map((r) => (
            <li key={r.key}><Link href={`/registers/${r.key}/sheet?blank=1`} className="text-brand-blue">{r.area} · {r.title}</Link> <span className="text-xs text-gray-500">{r.document_no}</span></li>
          ))}
        </ul>
      </section>

      <section className="card space-y-1">
        <h2 className="font-semibold">Outage history</h2>
        {outages.length === 0 && <p className="text-sm text-gray-500">None recorded.</p>}
        <ul className="space-y-1 text-sm">
          {outages.map((o) => (
            <li key={o.id}>{formatLagos(o.started_at)} → {o.ended_at ? formatLagos(o.ended_at) : "open"} · {o.reason}{o.end_note ? ` · ${o.end_note}` : ""}
              <span className="text-xs text-gray-500"> ({names.get(o.recorded_by_id ?? "") ?? "—"})</span></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
