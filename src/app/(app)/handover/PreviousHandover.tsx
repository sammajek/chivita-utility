import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { namesFor } from "@/lib/data/pm";
import { prevShift } from "@/lib/handover";
import { SHIFT_LABELS } from "@/lib/time";

/** For someone checked in: the previous shift's handover and whether they still have to acknowledge it. */
export async function PreviousHandover({ profileId }: { profileId: string }) {
  const supabase = await createClient();
  const { data: s } = await supabase.from("duty_sessions").select("shift_date, shift").eq("profile_id", profileId)
    .is("checked_out_at", null).order("checked_in_at", { ascending: false }).limit(1).maybeSingle();
  if (!s) return null;
  const prev = prevShift({ shiftDate: s.shift_date as string, shift: s.shift as "day" | "night" });
  const { data: h } = await supabase.from("handovers").select("id, recorded_by_id, received_at").eq("shift_date", prev.shiftDate)
    .eq("shift", prev.shift).eq("is_demo", false).maybeSingle();
  if (!h) {
    return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn">No handover was written for the previous shift ({SHIFT_LABELS[prev.shift]} · {prev.shiftDate}).</p>;
  }
  const { data: mine } = await supabase.from("handover_notes").select("id").eq("handover_id", h.id).eq("kind", "ack").eq("recorded_by_id", profileId).limit(1);
  if ((mine ?? []).length) return null;
  const names = await namesFor([h.recorded_by_id]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
      <span>
        <b>Handover from the previous shift</b> ({SHIFT_LABELS[prev.shift]} · {prev.shiftDate}, written by {names.get(h.recorded_by_id) ?? "—"})
        {h.received_at ? " — already acknowledged by a team-mate; you can acknowledge too." : " is waiting for your acknowledgement."}
      </span>
      <Link href={`/handover/${h.id}`} className="btn-primary btn-sm">Read &amp; acknowledge</Link>
    </div>
  );
}
