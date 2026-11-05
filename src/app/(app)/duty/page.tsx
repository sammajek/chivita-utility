import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos, SHIFT_LABELS, shiftAt } from "@/lib/time";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { DemoBadge } from "@/components/StatusBadge";
import { CheckInForm, CheckOutForm, VerifyPresenceForm } from "./DutyForms";

export const dynamic = "force-dynamic";

interface Session {
  id: string;
  profile_id: string;
  shift_date: string;
  shift: "day" | "night";
  areas: string[];
  checked_in_at: string;
  checked_out_at: string | null;
  handover_note: string | null;
  open_flags_at_checkout: number | null;
  is_demo: boolean;
  presence_verified_at: string | null;
  presence_area: string | null;
  profile: { full_name: string; role: Role } | null;
}

export default async function DutyPage({ searchParams }: { searchParams: Promise<{ room?: string; code?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const supabase = await createClient();
  const cur = shiftAt(new Date());
  const [{ data: sessions }, { count: openFlags }] = await Promise.all([
    supabase
      .from("duty_sessions")
      .select("id, profile_id, shift_date, shift, areas, checked_in_at, checked_out_at, handover_note, open_flags_at_checkout, is_demo, presence_verified_at, presence_area, profile:profiles(full_name, role)")
      .order("checked_in_at", { ascending: false })
      .limit(30),
    supabase.from("flags").select("id", { count: "exact", head: true }).is("resolved_at", null),
  ]);
  const list = (sessions ?? []) as unknown as Session[];
  const mine = list.find((s) => s.profile_id === profile.id && !s.checked_out_at);
  const onNow = list.filter((s) => !s.checked_out_at && s.shift_date === cur.shiftDate && s.shift === cur.shift);
  const handovers = list.filter((s) => s.handover_note).slice(0, 10);
  const canCheckIn = profile.role !== "viewer" && profile.active;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">On duty</h1>
        <p className="page-sub">Current shift: {SHIFT_LABELS[cur.shift]}, {cur.shiftDate} · <Link href="/duty/handover" className="text-brand-blue">Handover report (print)</Link></p>
      </div>

      {canCheckIn && (sp.room === "U1" || sp.room === "U2") && sp.code && <VerifyPresenceForm room={sp.room} code={sp.code} />}

      {canCheckIn && (
        <section className="card space-y-3">
          {mine ? (
            <>
              <p>
                You checked in at <b>{formatLagos(mine.checked_in_at)}</b> for{" "}
                {mine.areas.map((a) => (a === "U1" ? "Utility 1" : "Utility 2")).join(" & ")}.
              </p>
              <CheckOutForm openFlags={openFlags ?? 0} />
              <Link href="/flags" className="text-sm text-brand-blue">Review open flags →</Link>
            </>
          ) : (
            <>
              <p>Tap when you start your shift. If nobody checks in within 30 minutes of shift start, the section manager is alerted.</p>
              <CheckInForm defaultAreas={profile.areas} />
            </>
          )}
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">On duty now</h2>
        {onNow.length === 0 ? (
          <p className="card text-sm text-gray-500">Nobody has checked in for this shift yet.</p>
        ) : (
          <ul className="space-y-2">
            {onNow.map((s) => (
              <li key={s.id} className="card flex justify-between text-sm">
                <span><b>{s.profile?.full_name}</b> · {s.profile ? ROLE_LABELS[s.profile.role] : ""}</span>
                <span className="flex items-center gap-2 text-gray-500">{s.areas.join(" + ")} since {formatLagos(s.checked_in_at).slice(-5)}
                  {s.presence_verified_at
                    ? <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs font-semibold text-ok" title={`Scanned the ${s.presence_area} control-room code at ${formatLagos(s.presence_verified_at)}`}>✓ in control room</span>
                    : <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">not verified</span>}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">Recent handovers</h2>
        <ul className="space-y-2">
          {handovers.map((s) => (
            <li key={s.id} className="card text-sm">
              <div className="flex justify-between gap-2 text-xs text-gray-500">
                <span>{s.profile?.full_name} · {SHIFT_LABELS[s.shift]} {s.shift_date} {s.is_demo && <DemoBadge />}</span>
                <span>{s.checked_out_at ? formatLagos(s.checked_out_at) : ""} · {s.open_flags_at_checkout ?? 0} open flags</span>
              </div>
              <p className="mt-1 whitespace-pre-line">{s.handover_note}</p>
            </li>
          ))}
          {handovers.length === 0 && <li className="card text-sm text-gray-500">No handovers yet.</li>}
        </ul>
      </section>
    </div>
  );
}
