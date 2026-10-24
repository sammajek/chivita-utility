/** Running-hours service status (same rule as run_ops_flags in the database). */
export interface ServiceInterval {
  interval_hours: number;
  warn_before_hours: number;
  last_service_hours: number | null;
}

export type ServiceState = "ok" | "due_soon" | "overdue" | "no_baseline" | "no_reading";

export function serviceStatus(i: ServiceInterval, currentHours: number | null): { state: ServiceState; dueAt: number | null; remaining: number | null; label: string } {
  if (i.last_service_hours == null) return { state: "no_baseline", dueAt: null, remaining: null, label: "Record the last service to start tracking" };
  const dueAt = i.last_service_hours + i.interval_hours;
  if (currentHours == null) return { state: "no_reading", dueAt, remaining: null, label: `Due at ${dueAt.toLocaleString()} h (no running hours logged yet)` };
  const remaining = dueAt - currentHours;
  if (remaining <= 0) return { state: "overdue", dueAt, remaining, label: `Overdue by ${Math.round(-remaining).toLocaleString()} h (due at ${dueAt.toLocaleString()} h)` };
  if (remaining <= i.warn_before_hours) return { state: "due_soon", dueAt, remaining, label: `Due in ${Math.round(remaining).toLocaleString()} h (at ${dueAt.toLocaleString()} h)` };
  return { state: "ok", dueAt, remaining, label: `${Math.round(remaining).toLocaleString()} h to go (due at ${dueAt.toLocaleString()} h)` };
}
