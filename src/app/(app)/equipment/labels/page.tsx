import { headers } from "next/headers";
import QRCode from "qrcode";
import { requireProfile, can } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Logo } from "@/components/Logo";
import { PrintButton } from "@/components/PrintButton";
import { RoomCodes } from "./RoomCodes";
import { ScanLabels } from "./ScanLabels";

export const dynamic = "force-dynamic";

interface Asset { id: string; code: string; name: string; area: string | null; category: { name: string; sort: number } | null }

/**
 * Printable QR labels: one per machine (opens its equipment page: state, running hours, PM, photos, log downtime),
 * and (admin) the control-room check-in codes. Print on A4 sticker sheets or laminate.
 */
export default async function LabelsPage({ searchParams }: { searchParams: Promise<{ area?: string; cat?: string }> }) {
  const sp = await searchParams;
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const supabase = await createClient();
  let q = supabase.from("assets").select("id, code, name, area, category:asset_categories(name, sort)").neq("status", "retired").order("code");
  if (sp.area === "U1" || sp.area === "U2") q = q.eq("area", sp.area);
  const [{ data }, { data: cats }] = await Promise.all([q, supabase.from("asset_categories").select("name").order("sort")]);
  let assets = (data ?? []) as unknown as Asset[];
  if (sp.cat) assets = assets.filter((a) => a.category?.name === sp.cat);
  assets.sort((a, b) => (a.category?.sort ?? 99) - (b.category?.sort ?? 99) || a.code.localeCompare(b.code));

  const svg = (url: string) => QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#111827", light: "#ffffff" } });
  const labels = await Promise.all(assets.map(async (a) => ({ ...a, url: `${base}/equipment/${encodeURIComponent(a.code)}`, qr: await svg(`${base}/equipment/${encodeURIComponent(a.code)}`) })));
  const profile = await requireProfile();
  const canIssue = can(profile, "manager_tasks");
  const [{ data: issued }, { data: scanCodes }] = await Promise.all([supabase.rpc("checkin_codes_status"), supabase.rpc("asset_scan_codes_status")]);
  const coded = new Set(((scanCodes ?? []) as { asset_id: string }[]).map((r) => r.asset_id));
  const canIssueScan = can(profile, "shift_manager_tasks");

  return (
    <div className="space-y-4 bg-white">
      <form className="no-print flex flex-wrap items-end gap-2">
        <select name="area" defaultValue={sp.area ?? ""} className="input max-w-[10rem] py-2"><option value="">Both areas</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select>
        <select name="cat" defaultValue={sp.cat ?? ""} className="input max-w-xs py-2"><option value="">All categories</option>{(cats ?? []).map((c) => <option key={c.name}>{c.name}</option>)}</select>
        <button className="btn-secondary min-h-10">Show</button>
        <PrintButton />
        <span className="text-xs text-gray-500">{labels.length} labels · scanning opens the machine’s page (sign-in needed). Codes point to {base}.</span>
      </form>
      {canIssue && <RoomCodes issued={(issued ?? []) as { area: string; issued_at: string }[]} />}
      {canIssueScan && <ScanLabels assets={assets.map((a) => ({ id: a.id, code: a.code }))} withCode={assets.filter((a) => coded.has(a.id)).length} />}
      <h2 className="no-print section-title">Information Labels (Open the Machine’s Page)</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 print:grid-cols-3">
        {labels.map((a) => (
          <div key={a.code} className="flex break-inside-avoid items-center gap-2 rounded border p-2">
            <div className="h-24 w-24 shrink-0" dangerouslySetInnerHTML={{ __html: a.qr }} />
            <div className="min-w-0 text-sm">
              <Logo height={16} />
              <b className="mt-1 block text-base">{a.code}</b>
              <span className="block leading-tight">{a.name}</span>
              <span className="text-xs text-gray-500">{a.category?.name}{a.area ? ` · ${a.area}` : ""}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
