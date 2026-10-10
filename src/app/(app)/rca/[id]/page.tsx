import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadAssetsForPicker, loadLists } from "@/lib/data/lists";
import { RcaForm, type RcaValues } from "../RcaForm";

export const dynamic = "force-dynamic";

export default async function RcaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ downtime?: string; saved?: string }> }) {
  const profile = await requireProfile();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const [lists, assets] = await Promise.all([loadLists(), loadAssetsForPicker()]);
  const l = Object.fromEntries(Object.entries(lists).map(([k, v]) => [k, v.map((i) => i.value)]));

  let r: RcaValues = {};
  let title = "New RCA";
  if (id !== "new") {
    const { data } = await supabase.from("rcas").select("*").eq("id", id).maybeSingle();
    if (!data) notFound();
    r = data as RcaValues;
    title = (data as { rca_no: string }).rca_no;
  } else if (sp.downtime) {
    const { data: e } = await supabase.from("downtime_events").select("id, asset_id, event_no, failure_mode, rca_reason").eq("id", sp.downtime).maybeSingle();
    if (e) r = { downtime_id: e.id, asset_id: e.asset_id, problem: `${e.event_no}: ${e.failure_mode}. ${e.rca_reason ?? ""}` };
  }
  const canEdit = ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);
  return (
    <div className="space-y-4">
      <Link href="/rca" className="text-sm text-brand-blue">← RCA register</Link>
      <h1 className="text-2xl font-bold">{title}</h1>
      {sp.saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-ok">Saved.</p>}
      <RcaForm r={r} assets={assets} lists={l} readOnly={!canEdit} />
    </div>
  );
}
