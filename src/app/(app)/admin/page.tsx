import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ROLES, ROLE_LABELS } from "@/lib/roles";
import { ActionForm } from "@/components/ActionForm";
import { describeStandard } from "@/lib/evaluate";
import { updateAsset, updateParameter, updateSetting, updateUser } from "./actions";
import { AliasToggle, MonitorToggle } from "./Toggles";
import type { Parameter } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  ["users", "Users"], ["review", "To review"], ["assets", "Equipment"], ["limits", "Limits"], ["registers", "Registers"], ["settings", "Settings"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const profile = await requireRole("admin", "section_manager");
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "review";
  const supabase = await createClient();
  const q = (sp.q ?? "").trim();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Admin</h1>
      <nav className="flex gap-1 overflow-x-auto">
        {TABS.map(([t, l]) => (
          <Link key={t} href={`/admin?tab=${t}`} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${t === tab ? "bg-brand-blue text-white" : "bg-white border"}`}>{l}</Link>
        ))}
      </nav>

      {tab === "users" && <Users canEdit={profile.role === "admin"} />}
      {tab === "review" && <Review />}
      {tab === "assets" && <Assets q={q} />}
      {tab === "limits" && <Limits q={q} />}
      {tab === "registers" && <Registers />}
      {tab === "settings" && <Settings />}
    </div>
  );

  async function Users({ canEdit }: { canEdit: boolean }) {
    const { data } = await supabase.from("profiles").select("id, full_name, email, role, areas, active, staff_id, phone, whatsapp").order("active").order("full_name");
    const users = (data ?? []) as { id: string; full_name: string; email: string; role: string; areas: string[]; active: boolean; staff_id: string | null; phone: string | null; whatsapp: string | null }[];
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">New people request access from the sign-in page (“Request access”). They stay inactive until you set their role and tick Active.</p>
        {users.map((u) => (
          <ActionForm key={u.id} action={updateUser} className={`card grid gap-2 sm:grid-cols-4 ${u.active ? "" : "border-amber-300"}`}>
            <input type="hidden" name="id" value={u.id} />
            <div className="sm:col-span-4 flex justify-between text-sm"><b>{u.full_name}</b><span className="text-gray-500">{u.email}</span></div>
            <select name="role" defaultValue={u.role} className="input py-2" disabled={!canEdit}>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <input name="staff_id" defaultValue={u.staff_id ?? ""} placeholder="Staff ID" className="input py-2" disabled={!canEdit} />
            <input name="phone" defaultValue={u.phone ?? ""} placeholder="Phone" className="input py-2" disabled={!canEdit} />
            <input name="whatsapp" defaultValue={u.whatsapp ?? ""} placeholder="WhatsApp" className="input py-2" disabled={!canEdit} />
            <div className="flex flex-wrap items-center gap-3 text-sm sm:col-span-4">
              {["U1", "U2"].map((a) => (
                <label key={a} className="flex items-center gap-1"><input type="checkbox" name="areas" value={a} defaultChecked={u.areas.includes(a)} disabled={!canEdit} />{a}</label>
              ))}
              <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={u.active} disabled={!canEdit} /> Active</label>
            </div>
          </ActionForm>
        ))}
      </div>
    );
  }

  async function Review() {
    const [{ data: aliases }, { data: assets }, { data: params }] = await Promise.all([
      supabase.from("asset_aliases").select("id, alias, source, confirmed, asset:assets(code, name)").eq("confirmed", false).order("source"),
      supabase.from("assets").select("id, code, name, notes").eq("confirmed", false).order("code"),
      supabase.from("parameters").select("id, equipment_group, name, unit, std_min, std_max, ok_options, standard_as_written, alt_standard, review_note").eq("needs_review", true).order("equipment_group"),
    ]);
    return (
      <div className="space-y-4">
        <section className="card">
          <h2 className="font-semibold">Standards to decide ({(params ?? []).length})</h2>
          <p className="text-xs text-gray-500">Conflicts and gaps found in the spreadsheets. Edit them on the Limits tab and untick “needs review”.</p>
          <ul className="mt-2 divide-y text-sm">
            {((params ?? []) as (Parameter & { review_note: string })[]).map((p) => (
              <li key={p.id} className="py-2">
                <b>{p.equipment_group}: {p.name}</b> · now {describeStandard(p, p.unit)}
                <div className="text-xs text-warn">{p.review_note}</div>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 className="font-semibold">Equipment to confirm ({(assets ?? []).length})</h2>
          <ul className="mt-2 divide-y text-sm">
            {(assets ?? []).map((a) => (
              <li key={a.id} className="py-2"><b>{a.code}</b> {a.name}<div className="text-xs text-gray-500">{a.notes}</div></li>
            ))}
          </ul>
          <Link href="/admin?tab=assets" className="text-sm text-brand-blue">Edit on the Equipment tab →</Link>
        </section>
        <section className="card">
          <h2 className="font-semibold">Name mappings to confirm ({(aliases ?? []).length})</h2>
          <p className="text-xs text-gray-500">How each spreadsheet names a machine. Confirm if the mapping is right.</p>
          <ul className="mt-2 divide-y text-sm">
            {((aliases ?? []) as unknown as { id: string; alias: string; source: string; confirmed: boolean; asset: { code: string; name: string } }[]).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                <span>“{a.alias}” <span className="text-xs text-gray-500">({a.source.replace("_", " ")})</span> → <b>{a.asset.code}</b> {a.asset.name}</span>
                <AliasToggle id={a.id} confirmed={a.confirmed} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    );
  }

  async function Assets({ q }: { q: string }) {
    let query = supabase.from("assets").select("id, code, name, area, status, criticality, confirmed, notes").order("code");
    if (q) query = query.or(`code.ilike.%${q}%,name.ilike.%${q}%`);
    const { data } = await query;
    return (
      <div className="space-y-2">
        <form className="flex gap-2"><input type="hidden" name="tab" value="assets" /><input name="q" defaultValue={q} placeholder="Search code or name" className="input py-2" /><button className="btn-secondary min-h-10">Search</button></form>
        {(data ?? []).map((a) => (
          <ActionForm key={a.id} action={updateAsset} className="card grid gap-2 sm:grid-cols-5">
            <input type="hidden" name="id" value={a.id} />
            <div className="font-semibold sm:col-span-5">{a.code}</div>
            <input name="name" defaultValue={a.name} className="input py-2 sm:col-span-2" />
            <select name="area" defaultValue={a.area ?? ""} className="input py-2"><option value="">—</option><option>U1</option><option>U2</option></select>
            <select name="status" defaultValue={a.status} className="input py-2"><option>active</option><option>standby</option><option>retired</option></select>
            <select name="criticality" defaultValue={a.criticality ?? ""} className="input py-2"><option value="">Criticality</option><option>A</option><option>B</option><option>C</option></select>
            <input name="notes" defaultValue={a.notes ?? ""} placeholder="Notes" className="input py-2 sm:col-span-4" />
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="confirmed" defaultChecked={a.confirmed} /> Confirmed</label>
          </ActionForm>
        ))}
      </div>
    );
  }

  async function Limits({ q }: { q: string }) {
    let query = supabase.from("parameters").select("id, equipment_group, name, unit, data_type, std_min, std_max, crit_min, crit_max, standard_as_written, alt_standard, needs_review, review_note, is_counter")
      .eq("data_type", "number").eq("is_counter", false).order("needs_review", { ascending: false }).order("equipment_group").order("name");
    if (q) query = query.or(`name.ilike.%${q}%,equipment_group.ilike.%${q}%`);
    const { data } = await query;
    return (
      <div className="space-y-2">
        <form className="flex gap-2"><input type="hidden" name="tab" value="limits" /><input name="q" defaultValue={q} placeholder="Search parameter" className="input py-2" /><button className="btn-secondary min-h-10">Search</button></form>
        <p className="text-xs text-gray-500">Standard = in spec. Critical = triggers an immediate escalation to the shift manager. Leave blank for “no limit”.</p>
        {((data ?? []) as Parameter[]).map((p) => (
          <ActionForm key={p.id} action={updateParameter} className={`card grid grid-cols-2 gap-2 sm:grid-cols-6 ${p.needs_review ? "border-amber-300" : ""}`}>
            <input type="hidden" name="id" value={p.id} />
            <div className="col-span-2 sm:col-span-6 text-sm"><b>{p.equipment_group}: {p.name}</b>
              <span className="ml-2 text-xs text-gray-500">sheet: {p.standard_as_written ?? "—"}{p.alt_standard ? ` · elsewhere: ${p.alt_standard}` : ""}</span></div>
            <input name="std_min" defaultValue={p.std_min ?? ""} placeholder="Std min" inputMode="decimal" className="input py-2" />
            <input name="std_max" defaultValue={p.std_max ?? ""} placeholder="Std max" inputMode="decimal" className="input py-2" />
            <input name="crit_min" defaultValue={p.crit_min ?? ""} placeholder="Critical min" inputMode="decimal" className="input py-2" />
            <input name="crit_max" defaultValue={p.crit_max ?? ""} placeholder="Critical max" inputMode="decimal" className="input py-2" />
            <input name="unit" defaultValue={p.unit ?? ""} placeholder="Unit" className="input py-2" />
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="needs_review" defaultChecked={p.needs_review} /> Needs review</label>
          </ActionForm>
        ))}
      </div>
    );
  }

  async function Registers() {
    const { data } = await supabase.from("registers").select("id, key, area, document_no, title, monitor").order("area").order("sort");
    return (
      <div className="card">
        <p className="mb-2 text-sm text-gray-600">Turn on monitoring for a register when its operators start using the app. Missing readings then raise flags and escalate.</p>
        <ul className="divide-y text-sm">
          {(data ?? []).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span>{r.area} · <b>{r.title}</b> <span className="text-xs text-gray-500">{r.document_no}</span></span>
              <MonitorToggle id={r.id} monitor={r.monitor} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  async function Settings() {
    const { data } = await supabase.from("app_settings").select("key, value, description").order("key");
    return (
      <div className="space-y-2">
        {(data ?? []).map((s) => (
          <ActionForm key={s.key} action={updateSetting} className="card grid gap-2 sm:grid-cols-3">
            <input type="hidden" name="key" value={s.key} />
            <div className="text-sm sm:col-span-2"><b>{s.key}</b><div className="text-xs text-gray-500">{s.description}</div></div>
            <input name="value" defaultValue={JSON.stringify(s.value)} className="input py-2" />
          </ActionForm>
        ))}
      </div>
    );
  }
}
