"use client";

import { useActionState } from "react";
import { Logo } from "@/components/Logo";
import { issueScanLabels, type ScanLabels as State } from "./actions";

/** Managers: issue secret scan codes for the machines shown and print their "scan to verify" labels. */
export function ScanLabels({ assets, withCode }: { assets: { id: string; code: string }[]; withCode: number }) {
  const [s, action, pending] = useActionState<State, FormData>(issueScanLabels, {});
  return (
    <div className="space-y-3">
      <form action={action} className="no-print card space-y-2">
        <b className="section-title">PM Verification Labels (Scan at the Machine)</b>
        <p className="text-sm text-gray-600">These labels carry a secret code. Scanning one at the machine proves the person was there; PMs from monthly up can then be
          completed for that machine (for 12 hours). Once a machine has a code, its monthly-and-longer PMs need the scan. Issuing again makes the old labels stop working.</p>
        <p className="text-xs text-gray-500">{withCode} of {assets.length} machines shown already have a scan code.</p>
        {assets.map((a) => <input key={a.id} type="hidden" name="asset" value={a.id} />)}
        <button className="btn-secondary btn-sm" disabled={pending || !assets.length}>{pending ? "…" : `Issue scan codes for these ${assets.length} machines and show labels`}</button>
        {s.error && <p className="text-sm text-crit">{s.error}</p>}
      </form>
      {s.labels && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
          {s.labels.map((a) => (
            <div key={a.code} className="flex break-inside-avoid items-center gap-2 rounded border-2 border-brand-red p-2">
              <div className="h-24 w-24 shrink-0" dangerouslySetInnerHTML={{ __html: a.svg }} />
              <div className="min-w-0 text-sm">
                <Logo height={16} />
                <b className="mt-1 block text-base">{a.code}</b>
                <span className="block leading-tight">{a.name}</span>
                <span className="text-xs text-gray-500">Scan before PM{a.area ? ` · ${a.area}` : ""}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
