"use client";

import { useTransition } from "react";
import { confirmAlias, setMonitor } from "./actions";

export function AliasToggle({ id, confirmed }: { id: string; confirmed: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => confirmAlias(id, !confirmed))}
      className={`rounded px-2 py-1 text-xs font-semibold ${confirmed ? "bg-green-100 text-ok" : "bg-amber-100 text-warn"}`}>
      {confirmed ? "Confirmed" : "Confirm"}
    </button>
  );
}

export function MonitorToggle({ id, monitor }: { id: string; monitor: boolean }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} onClick={() => start(() => setMonitor(id, !monitor))}
      className={`rounded px-2 py-1 text-xs font-semibold ${monitor ? "bg-blue-100 text-brand-blue" : "bg-gray-100 text-gray-600"}`}>
      {monitor ? "Monitored: on" : "Monitored: off"}
    </button>
  );
}
