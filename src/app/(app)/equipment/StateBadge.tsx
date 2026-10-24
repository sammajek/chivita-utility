export const STATE_LABEL: Record<string, string> = { available: "Available", standby: "Standby", unavailable: "Unavailable" };
const STYLE: Record<string, string> = {
  available: "bg-green-100 text-ok", standby: "bg-blue-100 text-brand-blue", unavailable: "bg-red-100 text-crit",
};

export function StateBadge({ state, reason }: { state: string; reason?: string | null }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded px-2 py-0.5 text-xs font-semibold ${STYLE[state] ?? "bg-gray-100"}`}>
      {STATE_LABEL[state] ?? state}{reason ? ` · ${reason}` : ""}
    </span>
  );
}
