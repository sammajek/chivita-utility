import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { lagosDate } from "@/lib/time";
import { PERIODS, type Period } from "@/lib/deck/period";
import { SECTIONS, type SectionKey } from "@/lib/deck/sections";
import { ActionForm } from "@/components/ActionForm";
import { DeckForm } from "./DeckForm";
import { retireDeckTemplate } from "./actions";

export const dynamic = "force-dynamic";

const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface Saved {
  id: string; name: string; sections: string[]; area: string | null; period: string; shared: boolean; owner_id: string;
  schedule: string; schedule_dow: number | null; schedule_day: number | null; schedule_hour: number; recipients: string[]; last_run_at: string | null;
}

export default async function ReportsPage() {
  const profile = await requireProfile();
  if (!profile.active) return <p className="card text-sm text-gray-600">Your account is not active yet.</p>;
  const supabase = await createClient();
  const [{ data: tdata }, { data: pdata }] = await Promise.all([
    supabase.from("deck_templates").select("id, name, sections, area, period, shared, owner_id, schedule, schedule_dow, schedule_day, schedule_hour, recipients, last_run_at")
      .eq("active", true).order("name"),
    supabase.from("profiles").select("id, full_name").eq("active", true).order("full_name"),
  ]);
  const saved = (tdata ?? []) as Saved[];
  const people = ((pdata ?? []) as { id: string; full_name: string }[]).map((p) => ({ id: p.id, name: p.full_name }));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const isMgr = ["section_manager", "admin"].includes(profile.role);
  const canSchedule = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Reports &amp; Presentations</h1>
        <p className="page-sub">Build a PowerPoint deck from live data: logo, data period and “generated at” on every slide, editable charts, a source line on each slide, and your commentary.</p>
      </div>

      {saved.length > 0 && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Saved Templates</h2>
          <ul className="divide-y">
            {saved.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div>
                  <b>{t.name}</b> · {PERIODS[t.period as Period] ?? t.period}{t.area ? ` · ${t.area}` : ""}
                  <span className="block text-xs text-gray-500">
                    {t.sections.map((k) => SECTIONS[k as SectionKey] ?? k).join(" · ")}
                    {t.schedule !== "none" && ` · sent ${t.schedule === "weekly" ? `every ${DAYS[t.schedule_dow ?? 1]}` : `on day ${t.schedule_day} of each month`} at ${String(t.schedule_hour).padStart(2, "0")}:00 to ${t.recipients.map((r) => nameOf.get(r) ?? "?").join(", ")}`}
                    {t.last_run_at && ` · last sent ${t.last_run_at.slice(0, 10)}`}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <a href={`/reports/deck?saved=${t.id}`} className="btn-secondary px-3 py-1">Download</a>
                  {(t.owner_id === profile.id || isMgr) && (
                    <ActionForm action={retireDeckTemplate} submit="Remove" className="flex items-center gap-2"><input type="hidden" name="id" value={t.id} /></ActionForm>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DeckForm today={lagosDate(new Date())} people={people} canSchedule={canSchedule} />
      <p className="text-xs text-gray-500">Layout is a clean placeholder in Chivita colours; it switches to the corporate PowerPoint template once that is supplied. Printable reports are also on each page (PM report, consumption report, <Link href="/handover" className="text-brand-blue">handover</Link>, training, KPIs).</p>
    </div>
  );
}
