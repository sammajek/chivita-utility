"use client";

import { useActionState } from "react";
import { Logo } from "@/components/Logo";
import { issueRoomCodes, type RoomCodes as State } from "./actions";

/** Admin: issue and print the control-room check-in codes (proof of presence). */
export function RoomCodes({ issued }: { issued: { area: string; issued_at: string }[] }) {
  const [s, action, pending] = useActionState<State, FormData>(issueRoomCodes, {});
  return (
    <div className="space-y-3">
      <form action={action} className="no-print card space-y-2">
        <b className="section-title">Control-room check-in codes</b>
        <p className="text-sm text-gray-600">Stick the code inside each control room. Scanning it during check-in marks the shift “verified in control room”.
          Issuing new codes makes the old printouts stop working (do it if a code is photographed or monthly).</p>
        <p className="text-xs text-gray-500">{issued.length ? issued.map((i) => `${i.area}: issued ${i.issued_at.slice(0, 10)}`).join(" · ") : "No codes issued yet."}</p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="area" value="U1" defaultChecked className="h-5 w-5" /> Utility 1</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="area" value="U2" defaultChecked className="h-5 w-5" /> Utility 2</label>
          <button className="btn-secondary btn-sm" disabled={pending}>{pending ? "…" : "Issue new codes and show them"}</button>
        </div>
        {s.error && <p className="text-sm text-crit">{s.error}</p>}
      </form>
      {s.rooms && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {s.rooms.map((r) => (
            <div key={r.area} className="flex break-inside-avoid items-center gap-4 rounded-xl border-2 border-brand-red bg-white p-4">
              <div className="h-40 w-40 shrink-0" dangerouslySetInnerHTML={{ __html: r.svg }} />
              <div className="space-y-1"><Logo height={22} />
                <b className="block text-lg">{r.area === "U1" ? "Utility 1" : "Utility 2"} control room</b>
                <span className="block text-sm">Scan when you check in for your shift.</span>
                <span className="block text-xs text-gray-500">Keep inside the control room. Issued {new Date().toISOString().slice(0, 10)}.</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
