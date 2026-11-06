import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { namesFor } from "@/lib/data/pm";
import { HANDOVER_GROUPS, type HandoverContent } from "@/lib/handover";
import { formatLagos, SHIFT_LABELS } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { receiveHandover, signHandover } from "../actions";

export const dynamic = "force-dynamic";

const ANSWER = { yes: "Yes", no: "No", na: "N/A" } as const;

/** One handover in the template's layout (printable), with acknowledge / sign. */
export default async function HandoverView({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("handovers").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const h = data as { id: string; shift_date: string; shift: "day" | "night"; areas: string[]; content: HandoverContent; footnote: string | null;
    open_flags: number | null; recorded_by_id: string; recorded_at: string; received_by: string | null; received_at: string | null; received_note: string | null;
    manager_by: string | null; manager_at: string | null; manager_note: string | null };
  const names = await namesFor([h.recorded_by_id, h.received_by, h.manager_by]);
  const c = h.content;
  const cell = (v: string | undefined) => (v && v.trim() ? v : "—");
  const canAck = !h.received_at && h.recorded_by_id !== profile.id && profile.active && profile.role !== "viewer";
  const canSign = !h.manager_at && ["shift_manager", "section_manager", "admin"].includes(profile.role);

  return (
    <div className="space-y-4">
      <Link href="/handover" className="no-print text-sm text-brand-blue">← Handover notes</Link>
      <div className="card space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold uppercase tracking-wide">Utility handover report</h1>
            <p className="text-sm">Date: <b>{h.shift_date}</b> · Duty: <b>{SHIFT_LABELS[h.shift]}</b> · {h.areas.map((a) => (a === "U1" ? "Utility 1" : "Utility 2")).join(" & ")}</p>
            <PrintButton />
          </div>
          <Logo height={36} />
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th className="w-40">Equipment</th><th>Running</th><th>Standby</th><th>Maintenance / faults</th></tr></thead>
            <tbody>
              {HANDOVER_GROUPS.map((g) => (
                <tr key={g.key}>
                  <td className="font-semibold">{g.label}</td>
                  <td>{cell(c.groups?.[g.key]?.running)}</td><td>{cell(c.groups?.[g.key]?.standby)}</td>
                  <td className={c.groups?.[g.key]?.faults ? "text-crit" : ""}>{cell(c.groups?.[g.key]?.faults)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div><h2 className="section-title">Fuel usage (PNG / CNG / diesel)</h2><p className="text-sm">{cell(c.fuel)}</p></div>
          <div><h2 className="section-title">Caustic mixing</h2><p className="text-sm">{cell(c.caustic)}</p></div>
        </div>

        <div>
          <h2 className="section-title">Water treatment plant</h2>
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-gray-500">Raw water pump running</dt><dd>{cell(c.wtp?.raw_running)}</dd></div>
            <div><dt className="text-xs text-gray-500">Treated water pump running</dt><dd>{cell(c.wtp?.treated_running)}</dd></div>
            <div><dt className="text-xs text-gray-500">Standby</dt><dd>{cell(c.wtp?.standby)}</dd></div>
            <div><dt className="text-xs text-gray-500">pH</dt><dd>{cell(c.wtp?.ph)}</dd></div>
            <div><dt className="text-xs text-gray-500">Water level – raw</dt><dd>{cell(c.wtp?.raw_level)}</dd></div>
            <div><dt className="text-xs text-gray-500">Water level – treated</dt><dd>{cell(c.wtp?.treated_level)}</dd></div>
            <div className="sm:col-span-3"><dt className="text-xs text-gray-500">Maintenance / faults</dt><dd className={c.wtp?.faults ? "text-crit" : ""}>{cell(c.wtp?.faults)}</dd></div>
          </dl>
        </div>

        <div>
          <h2 className="section-title">End-of-shift checklist</h2>
          <ul className="mt-1 divide-y text-sm">
            {Object.entries(c.checklist ?? {}).map(([item, a]) => (
              <li key={item} className="flex flex-wrap justify-between gap-2 py-1.5">
                <span>{item}{a.note && <span className="block text-xs text-gray-600">{a.note}</span>}</span>
                <b className={a.answer === "no" ? "text-crit" : a.answer === "yes" ? "text-ok" : "text-gray-500"}>{ANSWER[a.answer] ?? a.answer}</b>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-gray-500">{h.open_flags ?? 0} open flag(s) were passed on.</p>
        </div>

        <div><h2 className="section-title">Footnote</h2><p className="whitespace-pre-line text-sm">{cell(h.footnote ?? undefined)}</p></div>

        <div className="grid gap-6 border-t pt-4 text-sm sm:grid-cols-3">
          <div><span className="text-xs text-gray-500">Utility Engineer (handed over)</span><b className="block">{names.get(h.recorded_by_id) ?? "—"}</b><span className="text-xs">{formatLagos(h.recorded_at)}</span></div>
          <div><span className="text-xs text-gray-500">Received by (incoming)</span><b className="block">{h.received_at ? names.get(h.received_by ?? "") : "—"}</b>
            {h.received_at && <span className="text-xs">{formatLagos(h.received_at)}{h.received_note ? ` · ${h.received_note}` : ""}</span>}</div>
          <div><span className="text-xs text-gray-500">Manager</span><b className="block">{h.manager_at ? names.get(h.manager_by ?? "") : "—"}</b>
            {h.manager_at && <span className="text-xs">{formatLagos(h.manager_at)}{h.manager_note ? ` · ${h.manager_note}` : ""}</span>}</div>
        </div>
      </div>

      {canAck && (
        <ActionForm action={receiveHandover} submit="I have read this handover" className="no-print card flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={h.id} /><input name="note" className="input max-w-md py-2" placeholder="Comment (optional)" />
        </ActionForm>
      )}
      {canSign && (
        <ActionForm action={signHandover} submit="Sign as manager" className="no-print card flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={h.id} /><input name="note" className="input max-w-md py-2" placeholder="Comment (optional)" />
        </ActionForm>
      )}
    </div>
  );
}
