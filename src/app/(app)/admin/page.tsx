import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { NAV, ROLES, ROLE_LABELS } from "@/lib/roles";
import { ActionForm } from "@/components/ActionForm";
import { formatLagos } from "@/lib/time";
import { describeStandard } from "@/lib/evaluate";
import { importStaffCsv, saveCause, saveStaff, setTempPassword, updateAsset, updateParameter, updateSetting, updateUser } from "./actions";
import { AliasToggle, MonitorToggle } from "./Toggles";
import type { Parameter } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  ["users", "Users"], ["staff", "Staff"], ["access", "Access"], ["review", "To review"], ["assets", "Equipment"], ["limits", "Limits"], ["registers", "Registers"], ["causes", "Downtime causes"], ["audit", "Audit trail"], ["settings", "Settings"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; type?: string; eq?: string; who?: string; t?: string; act?: string; from?: string }> }) {
  const profile = await requireRole("admin", "section_manager");
  const sp = await searchParams;
  const tab = TABS.some(([t]) => t === sp.tab) ? sp.tab! : "review";
  const supabase = await createClient();
  const q = (sp.q ?? "").trim();

  return (
    <div className="space-y-4">
      <h1 className="page-title">Admin</h1>
      <nav className="flex flex-wrap gap-2">
        {TABS.map(([t, l]) => (
          <Link key={t} href={`/admin?tab=${t}`} className={`tab ${t === tab ? "tab-on" : ""}`}>{l}</Link>
        ))}
      </nav>

      {tab === "users" && <Users canEdit={profile.role === "admin"} />}
      {tab === "staff" && <Staff canImport={profile.role === "admin"} />}
      {tab === "access" && <Access />}
      {tab === "review" && <Review />}
      {tab === "assets" && <Assets q={q} />}
      {tab === "limits" && <Limits q={q} />}
      {tab === "registers" && <Registers />}
      {tab === "causes" && <Causes type={sp.type ?? "Unplanned Breakdown"} eq={sp.eq ?? ""} />}
      {tab === "audit" && <Audit who={sp.who ?? ""} t={sp.t ?? ""} act={sp.act ?? ""} from={sp.from ?? ""} q={q} />}
      {tab === "settings" && <Settings />}
    </div>
  );

  async function Audit({ who, t, act, from, q }: { who: string; t: string; act: string; from: string; q: string }) {
    let query = supabase.from("audit_log").select("id, table_name, record_id, action, changed_by, changed_at, changed_fields, old_data, new_data, reason")
      .order("changed_at", { ascending: false }).limit(200);
    if (who) query = query.eq("changed_by", who);
    if (t) query = query.eq("table_name", t);
    if (act) query = query.eq("action", act);
    if (from) query = query.gte("changed_at", `${from}T00:00:00+01:00`);
    if (q) query = query.or(`reason.ilike.%${q}%,record_id.ilike.%${q}%`);
    const [{ data }, { data: people }] = await Promise.all([query, supabase.from("profiles").select("id, full_name").order("full_name")]);
    const rows = (data ?? []) as { id: number; table_name: string; record_id: string; action: string; changed_by: string | null; changed_at: string;
      changed_fields: string[] | null; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; reason: string | null }[];
    const name = new Map(((people ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]));
    const show = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v)).slice(0, 120);
    const label = (tbl: string) => tbl.replace(/^public\./, "").replace(/_/g, " ");
    const tables = [...new Set(rows.map((r) => r.table_name))].sort();
    const ACTION: Record<string, string> = { insert: "Created", update: "Changed", void: "Voided / deleted" };
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Every record created, changed or voided (deleted) in the app, by anyone: who, when, what changed (old → new) and the reason. Entries cannot be edited or removed. Latest 200 matching entries.</p>
        <form className="flex flex-wrap items-center gap-2" action="/admin">
          <input type="hidden" name="tab" value="audit" />
          <select name="who" defaultValue={who} className="input w-auto py-2"><option value="">Anyone</option>{[...name.entries()].map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
          <select name="act" defaultValue={act} className="input w-auto py-2"><option value="">Any action</option><option value="insert">Created</option><option value="update">Changed</option><option value="void">Voided / deleted</option></select>
          <select name="t" defaultValue={t} className="input w-auto py-2"><option value="">Any record type</option>{[...new Set([...tables, t].filter(Boolean))].map((x) => <option key={x} value={x}>{label(x)}</option>)}</select>
          <input type="date" name="from" defaultValue={from} className="input w-auto py-2" aria-label="From date" />
          <input name="q" defaultValue={q} placeholder="Reason or record id" className="input w-48 py-2" />
          <button className="btn-secondary btn-sm">Filter</button>
        </form>
        <div className="table-wrap">
          <table className="data-table min-w-[900px]">
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>What changed</th><th>Reason</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatLagos(r.changed_at)}</td>
                  <td>{r.changed_by ? name.get(r.changed_by) ?? "—" : <span className="text-gray-500">System / logger</span>}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${r.action === "void" ? "bg-red-100 text-crit" : r.action === "update" ? "bg-amber-100 text-warn" : "bg-gray-100 text-gray-700"}`}>{ACTION[r.action] ?? r.action}</span></td>
                  <td className="capitalize">{label(r.table_name)}</td>
                  <td className="text-xs">
                    {r.action === "update" && r.changed_fields?.length
                      ? r.changed_fields.slice(0, 6).map((f) => <div key={f}><b>{f.replace(/_/g, " ")}</b>: {show(r.old_data?.[f])} → {show(r.new_data?.[f])}</div>)
                      : r.action === "void" ? <span>{show(r.old_data?.void_reason ?? r.new_data?.void_reason ?? "")}</span> : <span className="text-gray-500">new record</span>}
                  </td>
                  <td className="text-sm">{r.reason ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} className="text-gray-500">No entries match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  async function Causes({ type, eq }: { type: string; eq: string }) {
    const [{ data: types }, { data: cats }, { data: rows }] = await Promise.all([
      supabase.from("lists").select("value").eq("list_name", "downtime_type").eq("active", true).order("sort"),
      supabase.from("asset_categories").select("name").order("sort"),
      (() => {
        let q = supabase.from("downtime_causes").select("id, downtime_type, equipment_category, failure_category, failure_mode, issue_descriptions, active")
          .eq("downtime_type", type).order("failure_category").order("sort");
        q = eq === "_all" ? q.is("equipment_category", null) : eq ? q.eq("equipment_category", eq) : q;
        return q;
      })(),
    ]);
    const list = (rows ?? []) as { id: string; downtime_type: string; equipment_category: string | null; failure_category: string; failure_mode: string; issue_descriptions: string[]; active: boolean }[];
    const catNames = ((cats ?? []) as { name: string }[]).map((c) => c.name);
    const href = (o: Record<string, string>) => `/admin?${new URLSearchParams({ tab: "causes", type, ...(eq ? { eq } : {}), ...o })}`;
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">The cause lists on the downtime form: downtime type → failure category → failure mode → suggested issue descriptions. A cause with no equipment applies to every machine. Untick “in use” to retire a cause (old events keep it).</p>
        <div className="flex flex-wrap gap-2">
          {((types ?? []) as { value: string }[]).map((t) => <Link key={t.value} href={href({ type: t.value })} className={`tab ${t.value === type ? "tab-on" : ""}`}>{t.value}</Link>)}
        </div>
        <form className="flex flex-wrap items-center gap-2" action="/admin">
          <input type="hidden" name="tab" value="causes" /><input type="hidden" name="type" value={type} />
          <select name="eq" defaultValue={eq} className="input w-auto py-2">
            <option value="">All equipment</option><option value="_all">Every machine (general causes)</option>
            {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="btn-secondary btn-sm">Show</button>
          <span className="text-xs text-gray-500">{list.length} cause(s)</span>
        </form>
        <details className="card">
          <summary className="cursor-pointer section-title">+ Add a cause</summary>
          <ActionForm action={saveCause} submit="Add cause" className="mt-3 grid gap-2 sm:grid-cols-2">
            <select name="downtime_type" defaultValue={type} className="input">{((types ?? []) as { value: string }[]).map((t) => <option key={t.value}>{t.value}</option>)}</select>
            <select name="equipment_category" defaultValue={eq && eq !== "_all" ? eq : ""} className="input"><option value="">Every machine</option>{catNames.map((c) => <option key={c}>{c}</option>)}</select>
            <input name="failure_category" required minLength={3} placeholder="Failure category (e.g. Mechanical)" className="input" />
            <input name="failure_mode" required minLength={3} placeholder="Failure mode (e.g. Separator element blocked)" className="input" />
            <textarea name="issue_descriptions" rows={3} placeholder="Suggested issue descriptions, one per line (optional)" className="input sm:col-span-2" />
          </ActionForm>
        </details>
        <div className="space-y-2">
          {list.map((c) => (
            <ActionForm key={c.id} action={saveCause} className={`card grid gap-2 sm:grid-cols-4 ${c.active ? "" : "opacity-60"}`}>
              <input type="hidden" name="id" value={c.id} /><input type="hidden" name="downtime_type" value={c.downtime_type} />
              <select name="equipment_category" defaultValue={c.equipment_category ?? ""} className="input py-2"><option value="">Every machine</option>{catNames.map((n) => <option key={n}>{n}</option>)}</select>
              <input name="failure_category" defaultValue={c.failure_category} className="input py-2" />
              <input name="failure_mode" defaultValue={c.failure_mode} className="input py-2 sm:col-span-2" />
              <textarea name="issue_descriptions" rows={2} defaultValue={c.issue_descriptions.join("\n")} placeholder="Issue descriptions, one per line" className="input py-2 text-sm sm:col-span-3" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={c.active} className="h-5 w-5" /> In use</label>
            </ActionForm>
          ))}
        </div>
      </div>
    );
  }

  async function Users({ canEdit }: { canEdit: boolean }) {
    const { data } = await supabase.from("profiles").select("id, full_name, email, role, areas, active, staff_id, phone, whatsapp").order("active").order("full_name");
    const users = (data ?? []) as { id: string; full_name: string; email: string; role: string; areas: string[]; active: boolean; staff_id: string | null; phone: string | null; whatsapp: string | null }[];
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">New people request access from the sign-in page (“Request access”). They stay inactive until you set their role and tick Active.</p>
        {users.map((u) => (
          <div key={u.id} className={`card space-y-3 ${u.active ? "" : "border-amber-300"}`}>
          <ActionForm action={updateUser} className="grid gap-2 sm:grid-cols-4">
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
          {canEdit && (
            <details className="border-t pt-2 text-sm">
              <summary className="cursor-pointer text-gray-600">Forgotten password? Set a temporary one</summary>
              <ActionForm action={setTempPassword} submit="Set temporary password" className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={u.id} />
                <input name="password" type="text" minLength={8} required autoComplete="off" placeholder="Temporary password (8+ characters, shown as typed)" className="input max-w-xs py-2" />
              </ActionForm>
            </details>
          )}
          </div>
        ))}
      </div>
    );
  }

  async function Staff({ canImport }: { canImport: boolean }) {
    const { data } = await supabase.from("staff")
      .select("id, staff_id, surname, first_name, full_name, band, job_title, area, email, phone, whatsapp, app_role, default_shift, active, profile:profiles(email, role, active)")
      .order("active", { ascending: false }).order("first_name");
    type S = { id: string; staff_id: string; surname: string; first_name: string; full_name: string; band: number | null; job_title: string | null;
      area: string | null; email: string | null; phone: string | null; whatsapp: string | null; app_role: string | null; default_shift: string | null;
      active: boolean; profile: { email: string; role: string; active: boolean } | null };
    const staff = (data ?? []) as unknown as S[];
    const fields = (s?: S) => (
      <>
        <input name="staff_id" defaultValue={s?.staff_id} placeholder="Staff ID *" className="input py-2" required />
        <input name="first_name" defaultValue={s?.first_name} placeholder="First name *" className="input py-2" required />
        <input name="surname" defaultValue={s?.surname} placeholder="Surname *" className="input py-2" required />
        <input name="band" defaultValue={s?.band ?? ""} placeholder="Band" inputMode="numeric" className="input py-2" />
        <input name="job_title" defaultValue={s?.job_title ?? ""} placeholder="Job title" className="input py-2" />
        <select name="area" defaultValue={s?.area ?? ""} className="input py-2"><option value="">Area: both</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select>
        <input name="email" type="email" defaultValue={s?.email ?? ""} placeholder="Email (for login)" className="input py-2" />
        <select name="app_role" defaultValue={s?.app_role ?? ""} className="input py-2">
          <option value="">No pre-approval</option>{ROLES.map((r) => <option key={r} value={r}>Pre-approve as {ROLE_LABELS[r]}</option>)}
        </select>
        <input name="phone" defaultValue={s?.phone ?? ""} placeholder="Phone" inputMode="tel" className="input py-2" />
        <input name="whatsapp" defaultValue={s?.whatsapp ?? ""} placeholder="WhatsApp" inputMode="tel" className="input py-2" />
        <select name="default_shift" defaultValue={s?.default_shift ?? ""} className="input py-2"><option value="">Shift: —</option><option value="day">Day</option><option value="night">Night</option></select>
        {s && <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={s.active} /> Active</label>}
      </>
    );
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Everyone in the Utility section, with or without a login (used for training, KPIs and competency).
          To give someone access: enter their <b>email</b> and pick <b>Pre-approve as…</b>. When they tap “Request access” on the sign-in page with that email, the account is active straight away with that role.</p>
        {staff.map((s) => (
          <ActionForm key={s.id} action={saveStaff} className={`card grid gap-2 sm:grid-cols-4 ${s.active ? "" : "opacity-60"}`}>
            <input type="hidden" name="id" value={s.id} />
            <div className="flex flex-wrap justify-between text-sm sm:col-span-4"><b>{s.full_name}</b>
              <span className={s.profile ? "text-ok" : "text-gray-500"}>{s.profile ? `Login: ${s.profile.email} (${ROLE_LABELS[s.profile.role as keyof typeof ROLE_LABELS]}${s.profile.active ? "" : ", inactive"})` : s.email && s.app_role ? "Pre-approved – waiting for sign-up" : "No login"}</span></div>
            {fields(s)}
          </ActionForm>
        ))}
        <details className="card"><summary className="cursor-pointer font-semibold">Add a staff member</summary>
          <ActionForm action={saveStaff} className="mt-2 grid gap-2 sm:grid-cols-4">{fields()}</ActionForm>
        </details>
        {canImport && (
          <details className="card"><summary className="cursor-pointer font-semibold">Import from Excel (paste)</summary>
            <p className="mt-1 text-xs text-gray-600">Copy the rows from Excel including a header row and paste below. Columns (any order): staff_id, surname, first_name, band, job_title, area (U1/U2), email, phone, whatsapp, role (operator / engineer / shift_manager / section_manager / admin / viewer), shift (day/night). Existing staff IDs are updated; only the columns you paste are changed.</p>
            <ActionForm action={importStaffCsv} submit="Import" className="mt-2 space-y-2">
              <textarea name="csv" rows={6} className="input font-mono text-xs" placeholder={"staff_id\tsurname\tfirst_name\temail\trole\n11102687\tAdeniji\tRasheed\trasheed@…\toperator"} />
            </ActionForm>
          </details>
        )}
      </div>
    );
  }

  function Access() {
    const can = (roles: readonly string[]) => ROLES.map((r) => <td key={r} className="center">{roles.includes(r) ? "✓" : ""}</td>);
    const eng = ["engineer", "shift_manager", "section_manager", "admin"];
    const entry = ["operator", ...eng];
    const mgr = ["section_manager", "admin"];
    const ACTIONS: [string, readonly string[]][] = [
      ["Enter readings, PM results, downtime, water results, evidence photos", entry],
      ["Change equipment state (available / standby / unavailable)", entry],
      ["Correct or void own readings (with reason)", entry],
      ["Correct or void anyone’s records; close downtime; resolve follow-ups", eng],
      ["RCA, calibration, AMC, jobs & POs, cleaning sign-off", eng],
      ["Affirm PM periods; tick training done", eng],
      ["Withdraw a PM affirmation; remove training records", mgr],
      ["Edit equipment specs and PM codes, limits, registers, staff", mgr],
      ["Users: activate, change roles, import staff", ["admin"]],
      ["Read-only: dashboards, reports, trends", ROLES],
    ];
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Who can do what. These rules are enforced by the database itself (row-level security), not only by hiding buttons, so they also apply to anyone using the data another way. Every change is recorded in the audit trail with who, when and why. An account stays inactive (read nothing) until an admin activates it or pre-approves the email on the Staff tab.</p>
        <div className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Actions</h2>
          <table className="data-table w-full min-w-[640px] text-sm">
            <thead><tr><th>Action</th>{ROLES.map((r) => <th key={r} className="center">{ROLE_LABELS[r]}</th>)}</tr></thead>
            <tbody>{ACTIONS.map(([l, r]) => <tr key={l}><td>{l}</td>{can(r)}</tr>)}</tbody>
          </table>
        </div>
        <div className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">Screens</h2>
          <table className="data-table w-full min-w-[640px] text-sm">
            <thead><tr><th>Screen</th>{ROLES.map((r) => <th key={r} className="center">{ROLE_LABELS[r]}</th>)}</tr></thead>
            <tbody>{NAV.map((n) => <tr key={n.href}><td>{n.label}</td>{can(n.roles)}</tr>)}</tbody>
          </table>
        </div>
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
    let query = supabase.from("assets").select("id, code, name, area, status, criticality, confirmed, notes, rated_output, rated_unit").order("code");
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
            <input name="rated_output" defaultValue={a.rated_output ?? ""} placeholder="Rated output (e.g. 3.5)" inputMode="decimal" className="input py-2" />
            <input name="rated_unit" defaultValue={a.rated_unit ?? ""} placeholder="Unit (t/h, m³/h, TR)" className="input py-2" />
            <input name="notes" defaultValue={a.notes ?? ""} placeholder="Notes" className="input py-2 sm:col-span-2" />
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
