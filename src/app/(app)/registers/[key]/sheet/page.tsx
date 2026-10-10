import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldsFor, loadRegister } from "@/lib/data/registers";
import { logDateOf, slotKeys, slotLabel } from "@/lib/registers";
import { describeStandard } from "@/lib/evaluate";
import { formatLagos } from "@/lib/time";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import type { Reading } from "@/lib/types";

export const dynamic = "force-dynamic";

const CELL: Record<string, string> = { out_of_spec: "bg-amber-100 font-semibold", critical: "bg-red-200 font-bold" };

export default async function SheetPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<{ date?: string; asset?: string }> }) {
  await requireProfile();
  const { key } = await params;
  const sp = await searchParams;
  const detail = await loadRegister(key);
  if (!detail) notFound();
  const { register, sections, assets } = detail;
  const multi = assets.length > 0;
  const asset = multi ? (assets.find((a) => a.id === sp.asset) ?? assets[0]) : null;
  const logDate = sp.date ?? logDateOf(new Date());

  const allFields = sections.flatMap((s) => fieldsFor(s, asset?.id ?? null, multi));
  const supabase = await createClient();
  const { data } = await supabase
    .from("readings")
    .select("id, field_id, asset_id, slot_key, value_num, value_text, status, recorded_by_id, amended, is_demo")
    .in("field_id", allFields.map((f) => f.id))
    .eq("log_date", logDate)
    .is("voided_at", null)
    .limit(10000);
  const readings = ((data ?? []) as Reading[]).filter((r) => !asset || r.asset_id === asset.id || allFields.find((f) => f.id === r.field_id)?.asset_id);
  const cell = new Map(readings.map((r) => [`${r.field_id}|${r.slot_key}`, r]));
  const recorders = [...new Set(readings.map((r) => r.recorded_by_id).filter(Boolean))] as string[];
  const { data: people } = recorders.length
    ? await supabase.from("profiles").select("id, full_name").in("id", recorders)
    : { data: [] as { id: string; full_name: string }[] };

  return (
    <div className="space-y-4 bg-white">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Logo height={40} />
          <div>
            <h1 className="text-lg font-bold uppercase">{register.title}</h1>
            <p className="text-sm">Department: Engineering · {register.area === "U1" ? "Utility 1" : "Utility 2"}</p>
          </div>
        </div>
        <div className="text-right text-sm">
          <div><b>Document No:</b> {register.document_no}</div>
          <div><b>Date:</b> {logDate} (07:00–07:00)</div>
          {asset && <div><b>Equipment:</b> {asset.code} {asset.name}</div>}
          <PrintButton />
        </div>
      </div>
      {readings.some((r) => r.is_demo) && <p className="text-sm font-semibold text-purple-700">Contains DEMO data</p>}

      {sections.map((s) => {
        const keys = slotKeys(s.slot_kind, s.slot_times);
        const fields = fieldsFor(s, asset?.id ?? null, multi);
        return (
          <div key={s.id} className="overflow-x-auto">
            <h2 className="mb-1 text-sm font-semibold">{s.title}</h2>
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-100">
                  <th className="border px-1 py-1 text-left">Parameter</th>
                  <th className="border px-1 py-1">Standard</th>
                  {keys.map((k) => <th key={k} className="border px-1 py-1">{slotLabel(s.slot_kind, k)}</th>)}
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td className="border px-1 py-1">{f.label}</td>
                    <td className="border px-1 py-1 text-center text-gray-600">{describeStandard(f.parameter, f.parameter.unit)}</td>
                    {keys.map((k) => {
                      const r = cell.get(`${f.id}|${k}`);
                      return (
                        <td key={k} className={`border px-1 py-1 text-center ${r ? CELL[r.status] ?? "" : ""}`}>
                          {r ? `${r.value_num ?? r.value_text}${r.amended ? "*" : ""}` : ""}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      <p className="text-xs text-gray-600">
        Entered by: {(people ?? []).map((p) => p.full_name).join(", ") || "—"} · * amended (see audit trail) · shaded = out of spec ·
        printed {formatLagos(new Date())}
      </p>
      <div className="grid grid-cols-2 gap-8 pt-6 text-sm">
        <div className="border-t pt-1">Engineer sign-off</div>
        <div className="border-t pt-1">Manager sign-off</div>
      </div>
    </div>
  );
}
