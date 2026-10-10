import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fieldsFor, loadRegister } from "@/lib/data/registers";
import { defaultSlot, logDateOf, slotDue, slotKeys, slotLabel } from "@/lib/registers";
import { formatLagos } from "@/lib/time";
import type { Reading } from "@/lib/types";
import { Corrections } from "./Corrections";
import { EntryForm } from "./EntryForm";

export const dynamic = "force-dynamic";

type Search = { asset?: string; date?: string; section?: string; slot?: string };

export default async function RegisterEntryPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  const profile = await requireProfile();
  const { key } = await params;
  const sp = await searchParams;
  const detail = await loadRegister(key);
  if (!detail) notFound();
  const { register, sections, assets, fieldAssets } = detail;

  const multiAsset = assets.length > 0;
  const assetId = multiAsset ? (assets.find((a) => a.id === sp.asset)?.id ?? assets[0].id) : null;
  const logDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : logDateOf(new Date());
  const section = sections.find((s) => s.id === sp.section) ?? sections[0];
  if (!section) notFound();
  const keys = slotKeys(section.slot_kind, section.slot_times);
  const slot = sp.slot && keys.includes(sp.slot) ? sp.slot : defaultSlot(section.slot_kind, section.slot_times, logDate);
  const due = slotDue(section.slot_kind, logDate, slot);
  const fields = fieldsFor(section, assetId, multiAsset);

  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("readings")
    .select("id, field_id, asset_id, log_date, slot_key, reading_for, value_num, value_text, status, comment, action_taken, minutes_late, recorded_by_id, recorded_at, amended, is_demo")
    .in("field_id", fields.map((f) => f.id))
    .eq("log_date", logDate)
    .eq("slot_key", slot)
    .is("voided_at", null);
  const existing: Record<string, Reading> = {};
  for (const r of (rows ?? []) as Reading[]) {
    const f = fields.find((x) => x.id === r.field_id);
    if (f && (f.asset_id || !assetId || r.asset_id === assetId)) existing[r.field_id] = r;
  }

  // slots of this section already filled (for the slot picker)
  const { data: filledRows } = await supabase
    .from("readings")
    .select("slot_key")
    .in("field_id", fields.map((f) => f.id))
    .eq("log_date", logDate)
    .match(assetId ? { asset_id: assetId } : {})
    .is("voided_at", null)
    .limit(5000);
  const filled = new Set((filledRows ?? []).map((r) => r.slot_key));

  const canEnter = ["operator", "engineer", "shift_manager", "section_manager", "admin"].includes(profile.role) && profile.active;
  const fieldAssetCodes = Object.fromEntries(fields.filter((f) => f.asset_id).map((f) => [f.id, fieldAssets[f.asset_id!]?.code ?? ""]));
  const href = (o: Partial<Search>) => {
    const q = new URLSearchParams({ ...(assetId ? { asset: assetId } : {}), date: logDate, section: section.id, slot, ...o });
    return `/registers/${key}?${q}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href="/registers" className="text-sm text-brand-blue">← Registers</Link>
          <h1 className="text-xl font-bold">{register.title}</h1>
          <p className="text-sm text-gray-600">
            {register.document_no} · {register.area === "U1" ? "Utility 1" : "Utility 2"}
          </p>
          {register.description && <p className="mt-1 text-xs text-warn">{register.description}</p>}
        </div>
        <div className="flex gap-2">
        <Link href={`/registers/${key}/trend${assetId ? `?asset=${assetId}` : ""}`} className="btn-secondary text-sm">
          Trends
        </Link>
        <Link href={`/registers/${key}/sheet?date=${logDate}${assetId ? `&asset=${assetId}` : ""}`} className="btn-secondary text-sm">
          Day sheet / print
        </Link>
        </div>
      </div>

      <form className="card grid gap-3 sm:grid-cols-3" action={`/registers/${key}`}>
        {multiAsset && (
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Equipment</span>
            <select name="asset" defaultValue={assetId ?? ""} className="input">
              {assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </label>
        )}
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Log date</span>
          <input type="date" name="date" defaultValue={logDate} className="input" />
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Section</span>
          <select name="section" defaultValue={section.id} className="input">
            {sections.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
        <button className="btn-secondary sm:col-span-3">Show</button>
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {keys.map((k) => (
          <Link key={k} href={href({ slot: k })}
            className={`shrink-0 rounded-lg border px-3 py-2 text-sm font-medium ${k === slot ? "border-brand-red bg-brand-red text-white" : filled.has(k) ? "border-green-300 bg-green-50 text-ok" : "border-gray-300 bg-white"}`}>
            {slotLabel(section.slot_kind, k)}{filled.has(k) && k !== slot ? " ✓" : ""}
          </Link>
        ))}
      </div>
      <p className="text-xs text-gray-500">Due {formatLagos(due)} · green = already entered</p>

      <EntryForm
        key={`${assetId}-${logDate}-${section.id}-${slot}`}
        registerKey={key}
        assetId={assetId}
        logDate={logDate}
        slotKey={slot}
        readingFor={due.toISOString()}
        fields={fields}
        fieldAssetCodes={fieldAssetCodes}
        existing={existing}
        canEnter={canEnter}
      />
      {canEnter && (
        <Corrections
          fields={fields}
          existing={existing}
          path={`/registers/${key}`}
          userId={profile.id}
          isEngineer={profile.role !== "operator"}
        />
      )}
    </div>
  );
}
