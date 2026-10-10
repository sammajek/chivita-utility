import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { cleaningCompliance } from "@/lib/amc";
import { namesFor } from "@/lib/data/pm";
import { pmPeriodLabel, pmPeriodStart } from "@/lib/pm";
import { logDateOf } from "@/lib/registers";
import { addDays, formatLagos } from "@/lib/time";
import { StatTile } from "@/components/BarList";
import { ActionForm } from "@/components/ActionForm";
import { CleaningForm, type Activity, type Check, type Zone } from "./CleaningForm";
import { signOff, voidCleaning } from "./actions";

export const dynamic = "force-dynamic";

export default async function CleaningPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const current = pmPeriodStart("weekly", logDateOf(new Date()));
  const week = sp.week && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) && sp.week <= current ? pmPeriodStart("weekly", sp.week) : current;
  const from8 = addDays(current, -56);

  const supabase = await createClient();
  const [{ data: z }, { data: a }, { data: c }, { data: so }, { data: hist }] = await Promise.all([
    supabase.from("cleaning_zones").select("id, day_of_week, area, name").order("day_of_week"),
    supabase.from("cleaning_activities").select("id, sort, name").order("sort"),
    supabase.from("cleaning_checks").select("id, zone_id, activity_id, result, note, recorded_by_id, is_demo").eq("week_start", week).is("voided_at", null),
    supabase.from("cleaning_signoffs").select("week_start, signed_by, signed_at, comment").gte("week_start", from8),
    supabase.from("cleaning_checks").select("week_start, result").gte("week_start", from8).lt("week_start", current).is("voided_at", null).limit(5000),
  ]);
  const zones = (z ?? []) as Zone[];
  const activities = (a ?? []) as Activity[];
  const checks = (c ?? []) as Check[];
  const signoffs = so ?? [];
  const signed = signoffs.find((s) => s.week_start === week);
  const names = Object.fromEntries(await namesFor([...checks.map((x) => x.recorded_by_id), ...signoffs.map((s) => s.signed_by)]));
  const perWeek = zones.length * activities.length;
  const weeks = Array.from({ length: 8 }, (_, i) => addDays(current, -7 * (8 - i)));
  const history = weeks.map((w) => {
    const rows = (hist ?? []).filter((h) => h.week_start === w);
    const done = rows.filter((h) => h.result === "done").length;
    return { w, done, pct: cleaningCompliance(perWeek, done), signed: signoffs.some((s) => s.week_start === w) };
  });
  const total = history.reduce((s, h) => s + h.done, 0);
  const canEnter = profile.active && !signed && ["operator", "engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  const canSign = profile.active && ["shift_manager", "section_manager", "admin"].includes(profile.role);
  const isEngineer = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold">Cleaning roster</h1>
        <p className="text-sm text-gray-600">Cleaning of Utility 1, 2 environment &amp; equipment · CHI/ENG/UTI/CLN/001</p>
      </div>

      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/cleaning?week=${addDays(week, -7)}`} className="btn-secondary px-3 py-2 text-sm" aria-label="Previous week">←</Link>
          <div className="text-center">
            <div className="font-semibold">{pmPeriodLabel("weekly", week)}</div>
            <div className="text-xs text-gray-500">{week === current ? "This week" : "Past week"}</div>
          </div>
          {week < current ? <Link href={`/cleaning?week=${addDays(week, 7)}`} className="btn-secondary px-3 py-2 text-sm" aria-label="Next week">→</Link>
            : <span className="px-3 py-2 text-gray-300">→</span>}
        </div>
        {signed ? (
          <span className="rounded bg-green-100 px-2 py-1 text-sm text-ok">
            Signed off by {names[signed.signed_by] ?? "manager"} · {formatLagos(signed.signed_at)}
          </span>
        ) : <span className="text-sm text-gray-500">Not signed off</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="This week" value={`${checks.filter((x) => x.result === "done").length}/${perWeek}`} sub="activities done" />
        <StatTile label="Last 8 weeks" value={cleaningCompliance(perWeek * 8, total) === null ? "–" : `${cleaningCompliance(perWeek * 8, total)}%`}
          sub="done ÷ expected (5 zones × 3 activities a week)" />
        <StatTile label="Weeks signed off" value={`${history.filter((h) => h.signed).length}/8`} />
      </div>

      <CleaningForm key={week} zones={zones} activities={activities} checks={checks} names={names} weekStart={week} canEnter={canEnter} />

      {canSign && !signed && (
        <div className="card">
          <h2 className="font-semibold">Manager sign-off</h2>
          <p className="text-xs text-gray-500">Signing off locks this week&apos;s entries.</p>
          <ActionForm action={signOff} submit="Sign off week" className="mt-2 space-y-2">
            <input type="hidden" name="week_start" value={week} />
            <input name="comment" className="input" placeholder="Comment (optional)" />
          </ActionForm>
        </div>
      )}

      {!signed && checks.some((x) => isEngineer || x.recorded_by_id === profile.id) && (
        <details className="card">
          <summary className="cursor-pointer font-medium">Void an entry made by mistake</summary>
          <div className="mt-2 space-y-3">
            {checks.filter((x) => isEngineer || x.recorded_by_id === profile.id).map((x) => (
              <ActionForm key={x.id} action={voidCleaning} submit="Void" className="space-y-1 border-t pt-2 text-sm">
                <input type="hidden" name="id" value={x.id} />
                <div>{zones.find((zz) => zz.id === x.zone_id)?.name.slice(0, 40)}… · {activities.find((aa) => aa.id === x.activity_id)?.name}: {x.result === "done" ? "Done" : "Not done"}</div>
                <input name="reason" required minLength={5} className="input" placeholder="Reason (required)" />
              </ActionForm>
            ))}
          </div>
        </details>
      )}

      <div className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Last 8 weeks</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-gray-500"><tr><th className="py-1">Week</th><th>Done</th><th>Compliance</th><th>Sign-off</th></tr></thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.w} className="border-t">
                <td className="py-1"><Link className="text-brand-blue" href={`/cleaning?week=${h.w}`}>{pmPeriodLabel("weekly", h.w)}</Link></td>
                <td>{h.done}/{perWeek}</td>
                <td className={(h.pct ?? 0) < 80 ? "text-warn" : ""}>{h.pct === null ? "–" : `${h.pct}%`}</td>
                <td>{h.signed ? "✓" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
