import { STATUS_LABEL, type ReadingStatus } from "@/lib/evaluate";

const STYLE: Record<ReadingStatus, string> = {
  ok: "bg-green-100 text-ok",
  out_of_spec: "bg-amber-100 text-warn",
  critical: "bg-red-100 text-crit",
  info: "bg-gray-100 text-gray-600",
};

export function StatusBadge({ status, className = "" }: { status: ReadingStatus; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${STYLE[status]} ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function DemoBadge() {
  return <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-purple-700">Demo</span>;
}
