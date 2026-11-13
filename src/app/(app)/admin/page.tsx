import Link from "next/link";
import { can, requireCap } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CAPABILITIES, NAV, ROLES, ROLE_LABELS, type Role } from "@/lib/roles";
import { ActionForm } from "@/components/ActionForm";
import { formatLagos } from "@/lib/time";
import { describeStandard } from "@/lib/evaluate";
import { addAsset, removeNeverExisted, saveMeter, saveRoleAccess, importStaffCsv, saveCause, saveCleaningActivity, saveCleaningZone, saveListItem, savePmTask, setRegisterAsset, saveStaff, setTempPassword, updateAsset, updateParameter, updateSetting, updateUser } from "./actions";
import { AliasToggle, MonitorToggle } from "./Toggles";
import type { Parameter } from "@/lib/types";

export const dynamic = "force-dynamic";

const TABS = [
  ["users", "Users"], ["staff", "Staff"], ["access", "Access"], ["review", "To Review"], ["assets", "Equipment Inventory"], ["limits", "Limits"], ["registers", "Equipment Registers"], ["pm", "PM Tasks"], ["meters", "Meters"], ["lists", "Pick Lists"], ["cleaning", "Cleaning Setup"], ["causes", "Downtime Causes"], ["audit", "Audit Trail"], ["settings", "Settings"],
] as const;

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; freq?: string; type?: string; eq?: string; who?: string; t?: string; act?: string; from?: string; role?: string }> }) {
  const profile = await requireCap("manager_tasks");
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

      {tab === "users" && <Users canEdit={can(profile, "admin_tasks")} />}
      {tab === "staff" && <Staff canImport={can(profile, "admin_tasks")} />}
      {tab === "access" && <Access />}
      {tab === "review" && <Review />}
      {tab === "assets" && <Assets q={q} />}
      {tab === "limits" && <Limits q={q} />}
      {tab === "registers" && <Registers />}
      {tab === "pm" && <PmTasks q={q} freq={sp.freq ?? ""} />}
      {tab === "meters" && <Meters />}
      {tab === "lists" && <PickLists />}
      {tab === "cleaning" && <CleaningSetup />}
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
          <summary className="cursor-pointer section-title">+ Add a Cause</summary>
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
    const { data } = await supabase.from("profiles").select("id, full_name, email, role, areas, active, staff_id, phone, whatsapp, work_pattern, default_shift, alerts").order("active").order("full_name");
    const users = (data ?? []) as { id: string; full_name: string; email: string; role: string; areas: string[]; active: boolean; staff_id: string | null; phone: string | null; whatsapp: string | null;
      work_pattern: string; default_shift: string | null; alerts: string[] }[];
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
            <PatternFields pattern={u.work_pattern === "office" ? "office" : u.default_shift ?? ""} alerts={u.alerts} disabled={!canEdit} />
          </ActionForm>
          {canEdit && (
            <details className="border-t pt-2 text-sm">
              <summary className="cursor-pointer text-gray-600">Forgotten Password? Set a Temporary One</summary>
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
      .select("id, staff_id, surname, first_name, full_name, band, job_title, area, email, phone, whatsapp, app_role, default_shift, work_pattern, alerts, active, profile:profiles(email, role, active)")
      .order("active", { ascending: false }).order("first_name");
    type S = { id: string; staff_id: string; surname: string; first_name: string; full_name: string; band: number | null; job_title: string | null;
      area: string | null; email: string | null; phone: string | null; whatsapp: string | null; app_role: string | null; default_shift: string | null;
      work_pattern: string; alerts: string[]; active: boolean; profile: { email: string; role: string; active: boolean } | null };
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
        <PatternFields pattern={s?.work_pattern === "office" ? "office" : s?.default_shift ?? ""} alerts={s?.alerts ?? []} />
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
        <details className="card"><summary className="cursor-pointer font-semibold">Add a Staff Member</summary>
          <ActionForm action={saveStaff} className="mt-2 grid gap-2 sm:grid-cols-4">{fields()}</ActionForm>
        </details>
        {canImport && (
          <details className="card"><summary className="cursor-pointer font-semibold">Import from Excel (Paste)</summary>
            <p className="mt-1 text-xs text-gray-600">Copy the rows from Excel including a header row and paste below. Columns (any order): staff_id, surname, first_name, band, job_title, area (U1/U2), email, phone, whatsapp, role (operator / engineer / shift_manager / section_manager / admin / viewer), shift (day / night / office for Mon–Fri 08:00–17:00). Existing staff IDs are updated; only the columns you paste are changed.</p>
            <ActionForm action={importStaffCsv} submit="Import" className="mt-2 space-y-2">
              <textarea name="csv" rows={6} className="input font-mono text-xs" placeholder={"staff_id\tsurname\tfirst_name\temail\trole\n11102687\tAdeniji\tRasheed\trasheed@…\toperator"} />
            </ActionForm>
          </details>
        )}
      </div>
    );
  }

  async function Access() {
    const editRole: Role = (ROLES as readonly string[]).includes(sp.role ?? "") ? (sp.role as Role) : "engineer";
    const { data } = await supabase.from("role_capabilities").select("role, capability, allowed");
    const rows = (data ?? []) as { role: Role; capability: string; allowed: boolean }[];
    const has = (r: Role, cap: string) => rows.some((x) => x.role === r && x.capability === cap && x.allowed);
    const screenOn = (r: Role, n: (typeof NAV)[number]) => {
      const o = rows.find((x) => x.role === r && x.capability === `screen:${n.href}`);
      return o ? o.allowed : n.roles.includes(r);
    };
    const isAdmin = can(profile, "admin_tasks");
    const tick = (on: boolean) => <span className={on ? "font-semibold text-ok" : "text-gray-300"}>{on ? "✓" : "–"}</span>;
    return (
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Who can do what. These rights are enforced by the database itself (row-level security), not only by hiding buttons. Every change is recorded in the Audit Trail with who and when. An account stays inactive (reads nothing) until an admin activates it or pre-approves the email on the Staff tab.</p>

        <section className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Edit a Role: {ROLE_LABELS[editRole]}</h2>
            <nav className="flex flex-wrap gap-1 text-sm">
              {ROLES.map((r) => <Link key={r} href={`/admin?tab=access&role=${r}`} className={`tab ${r === editRole ? "tab-on" : ""}`}>{ROLE_LABELS[r]}</Link>)}
            </nav>
          </div>
          {!isAdmin && <p className="text-sm text-warn">Only an admin can change access rights. You can view them.</p>}
          <ActionForm action={saveRoleAccess} submit={`Save ${ROLE_LABELS[editRole]} access`} readOnly={!isAdmin} className="space-y-3">
            <input type="hidden" name="role" value={editRole} />
            <fieldset disabled={!isAdmin} className="space-y-3">
              <div>
                <h3 className="mb-1 text-sm font-semibold">What this role can do</h3>
                <ul className="divide-y rounded-lg border border-gray-200">
                  {CAPABILITIES.map((c) => {
                    const locked = editRole === "admin";
                    return (
                      <li key={c.key}>
                        <label className="flex min-h-12 items-start gap-3 p-2">
                          <input type="checkbox" name="cap" value={c.key} defaultChecked={has(editRole, c.key)} disabled={locked} className="mt-0.5 h-5 w-5 shrink-0" />
                          <span><span className="font-medium">{c.label}</span><span className="block text-xs text-gray-500">{c.detail}</span></span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
                {editRole === "admin" && <p className="mt-1 text-xs text-gray-500">The Admin role always keeps every right, so nobody can be locked out.</p>}
              </div>
              <div>
                <h3 className="mb-1 text-sm font-semibold">Screens in the menu</h3>
                <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                  {NAV.map((n) => (
                    <label key={n.href} className="flex min-h-11 items-center gap-2 rounded border border-gray-200 px-2 text-sm">
                      <input type="checkbox" name="screen" value={n.href} defaultChecked={screenOn(editRole, n)}
                        disabled={editRole === "admin" && n.href === "/admin"} className="h-5 w-5" />
                      {n.label}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">Hiding a screen removes it from the menu. What a person can change is set by the rights above.</p>
              </div>
            </fieldset>
          </ActionForm>
        </section>

        <section className="card overflow-x-auto">
          <h2 className="mb-2 font-semibold">All Roles at a Glance</h2>
          <table className="data-table w-full min-w-[640px] text-sm">
            <thead><tr><th>Right</th>{ROLES.map((r) => <th key={r} className="center">{ROLE_LABELS[r]}</th>)}</tr></thead>
            <tbody>
              {CAPABILITIES.map((c) => <tr key={c.key}><td><b>{c.label}</b><div className="text-xs text-gray-500">{c.detail}</div></td>{ROLES.map((r) => <td key={r} className="center">{tick(has(r, c.key))}</td>)}</tr>)}
              {NAV.map((n) => <tr key={n.href}><td>Screen: {n.label}</td>{ROLES.map((r) => <td key={r} className="center">{tick(screenOn(r, n))}</td>)}</tr>)}
            </tbody>
          </table>
        </section>
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
          <h2 className="font-semibold">Standards to Decide ({(params ?? []).length})</h2>
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
          <h2 className="font-semibold">Equipment to Confirm ({(assets ?? []).length})</h2>
          <ul className="mt-2 divide-y text-sm">
            {(assets ?? []).map((a) => (
              <li key={a.id} className="py-2"><b>{a.code}</b> {a.name}<div className="text-xs text-gray-500">{a.notes}</div></li>
            ))}
          </ul>
          <Link href="/admin?tab=assets" className="text-sm text-brand-blue">Edit on the Equipment tab →</Link>
        </section>
        <section className="card">
          <h2 className="font-semibold">Name Mappings to Confirm ({(aliases ?? []).length})</h2>
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
    let query = supabase.from("assets").select("id, code, name, area, status, criticality, confirmed, notes, rated_output, rated_unit, category_id, make, model, capacity, location").order("code");
    if (q) query = query.or(`code.ilike.%${q}%,name.ilike.%${q}%`);
    const [{ data }, { data: cats }] = await Promise.all([query, supabase.from("asset_categories").select("id, name").order("sort")]);
    const catOpts = ((cats ?? []) as { id: number; name: string }[]).map((c) => <option key={c.id} value={c.id}>{c.name}</option>);
    const L = ({ t, children }: { t: string; children: React.ReactNode }) => <label className="block"><span className="text-xs text-gray-500">{t}</span>{children}</label>;
    return (
      <div className="space-y-2">
        <form className="flex gap-2"><input type="hidden" name="tab" value="assets" /><input name="q" defaultValue={q} placeholder="Search code or name" className="input py-2" /><button className="btn-secondary min-h-10">Search</button></form>
        <details className="card">
          <summary className="cursor-pointer section-title">+ Add Equipment</summary>
          <ActionForm action={addAsset} submit="Add equipment" className="mt-3 grid gap-2 sm:grid-cols-4">
            <L t="Code *"><input name="code" required placeholder="e.g. CMP-14" className="input py-2 uppercase" /></L>
            <div className="sm:col-span-2"><L t="Name *"><input name="name" required className="input py-2" placeholder="e.g. Air Compressor 14 - Oil-free (Atlas Copco)" /></L></div>
            <L t="Category *"><select name="category_id" required className="input py-2">{catOpts}</select></L>
            <L t="Area"><select name="area" className="input py-2"><option value="">—</option><option>U1</option><option>U2</option></select></L>
            <L t="Make"><input name="make" className="input py-2" /></L>
            <L t="Model"><input name="model" className="input py-2" /></L>
            <L t="Capacity"><input name="capacity" className="input py-2" /></L>
            <L t="Location"><input name="location" className="input py-2" /></L>
            <L t="Criticality"><select name="criticality" className="input py-2"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></L>
          </ActionForm>
        </details>
        <p className="text-xs text-gray-500">To remove a machine, set its status to “retired”: it disappears from forms and lists, and its history is kept.</p>
        {(data ?? []).map((a) => (
          <div key={a.id}>
          <ActionForm action={updateAsset} className={`card grid gap-2 sm:grid-cols-4 ${a.status === "retired" ? "opacity-60" : ""}`}>
            <input type="hidden" name="id" value={a.id} />
            <div className="font-semibold sm:col-span-4">{a.code}</div>
            <div className="sm:col-span-2"><L t="Name"><input name="name" defaultValue={a.name} className="input py-2" /></L></div>
            <L t="Category"><select name="category_id" defaultValue={a.category_id} className="input py-2">{catOpts}</select></L>
            <L t="Area"><select name="area" defaultValue={a.area ?? ""} className="input py-2"><option value="">—</option><option>U1</option><option>U2</option></select></L>
            <L t="Make"><input name="make" defaultValue={a.make ?? ""} className="input py-2" /></L>
            <L t="Model"><input name="model" defaultValue={a.model ?? ""} className="input py-2" /></L>
            <L t="Capacity"><input name="capacity" defaultValue={a.capacity ?? ""} className="input py-2" /></L>
            <L t="Location"><input name="location" defaultValue={a.location ?? ""} className="input py-2" /></L>
            <L t="Status"><select name="status" defaultValue={a.status} className="input py-2"><option>active</option><option>standby</option><option>retired</option></select></L>
            <L t="Criticality"><select name="criticality" defaultValue={a.criticality ?? ""} className="input py-2"><option value="">—</option><option>A</option><option>B</option><option>C</option></select></L>
            <L t="Rated output"><input name="rated_output" defaultValue={a.rated_output ?? ""} placeholder="e.g. 3.5" inputMode="decimal" className="input py-2" /></L>
            <L t="Rated unit"><input name="rated_unit" defaultValue={a.rated_unit ?? ""} placeholder="t/h, m³/h, TR" className="input py-2" /></L>
            <div className="sm:col-span-3"><L t="Notes"><input name="notes" defaultValue={a.notes ?? ""} className="input py-2" /></L></div>
            <label className="flex items-center gap-1 self-end pb-2 text-sm"><input type="checkbox" name="confirmed" defaultChecked={a.confirmed} /> Confirmed</label>
          </ActionForm>
          {a.status === "retired" && can(profile, "admin_tasks") && (
            <ActionForm action={removeNeverExisted} submit={`Remove ${a.code} permanently`} className="-mt-1 flex flex-wrap items-center gap-2 rounded-b-xl bg-red-50 p-2">
              <input type="hidden" name="code" value={a.code} />
              <input name="reason" required minLength={5} className="input max-w-md py-2" placeholder="Why (e.g. never existed, duplicate entry)" />
              <span className="text-xs text-gray-600">Only for equipment that never existed. Decommissioned equipment stays retired.</span>
            </ActionForm>
          )}
          </div>
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
    const [{ data }, { data: ra }, { data: assets }] = await Promise.all([
      supabase.from("registers").select("id, key, area, document_no, title, monitor, active").order("area").order("sort"),
      supabase.from("register_assets").select("register_id, active, asset:assets(id, code, name, status)"),
      supabase.from("assets").select("id, code, name, area").neq("status", "retired").order("code"),
    ]);
    const links = (ra ?? []) as unknown as { register_id: string; active: boolean; asset: { id: string; code: string; name: string; status: string } | null }[];
    const all = (assets ?? []) as { id: string; code: string; name: string; area: string | null }[];
    return (
      <div className="space-y-2">
        <p className="text-sm text-gray-600">Monitoring: turn on when operators start using the app for that register (missing readings then raise flags). Machines: the equipment each register is filled for. Taking a machine off keeps its past readings.</p>
        {(data ?? []).map((r) => {
          const on = links.filter((l) => l.register_id === r.id && l.active && l.asset && l.asset.status !== "retired");
          const ids = new Set(on.map((l) => l.asset!.id));
          return (
            <details key={r.id} className={`card ${r.active ? "" : "opacity-60"}`}>
              <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                <span>{r.area} · <b>{r.title}</b> <span className="text-xs text-gray-500">{r.document_no} · {on.length} machine(s){r.active ? "" : " · switched off"}</span></span>
                <MonitorToggle id={r.id} monitor={r.monitor} />
              </summary>
              <ul className="mt-3 divide-y text-sm">
                {on.map((l) => (
                  <li key={l.asset!.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span><b>{l.asset!.code}</b> <span className="text-gray-500">{l.asset!.name}</span></span>
                    <ActionForm action={setRegisterAsset} submit="Take off" className="flex items-center">
                      <input type="hidden" name="register_id" value={r.id} /><input type="hidden" name="asset_id" value={l.asset!.id} /><input type="hidden" name="on" value="0" />
                    </ActionForm>
                  </li>
                ))}
                {on.length === 0 && <li className="py-1.5 text-gray-500">No machines (readings not tied to one machine).</li>}
              </ul>
              {!r.active && can(profile, "admin_tasks") && (
                <ActionForm action={removeNeverExisted} submit="Remove permanently" className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2">
                  <input type="hidden" name="register_id" value={r.id} />
                  <input name="reason" required minLength={5} className="input max-w-md py-2" placeholder="Why (e.g. this register never applied)" />
                  <span className="text-xs text-gray-600">Only for a register that never applied; refused if it has real readings.</span>
                </ActionForm>
              )}
              <ActionForm action={setRegisterAsset} submit="Add machine" className="mt-2 flex flex-wrap items-center gap-2">
                <input type="hidden" name="register_id" value={r.id} /><input type="hidden" name="on" value="1" />
                <select name="asset_id" className="input w-auto py-2" defaultValue="">
                  <option value="">Choose a machine…</option>
                  {all.filter((x) => !ids.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}{x.area ? ` (${x.area})` : ""}</option>)}
                </select>
              </ActionForm>
            </details>
          );
        })}
      </div>
    );
  }

  async function PmTasks({ q, freq }: { q: string; freq: string }) {
    let query = supabase.from("pm_tasks").select("id, frequency, register_sn, equipment_as_written, asset_id, area, tasks, hours_interval, active").order("register_sn").limit(120);
    if (freq) query = query.eq("frequency", freq);
    if (q) query = query.ilike("equipment_as_written", `%${q}%`);
    const [{ data }, { data: assets }] = await Promise.all([query, supabase.from("assets").select("id, code, name").neq("status", "retired").order("code")]);
    const rows = (data ?? []) as { id: string; frequency: string; register_sn: number; equipment_as_written: string; asset_id: string | null; area: string; tasks: string[]; hours_interval: number | null; active: boolean }[];
    const aOpts = ((assets ?? []) as { id: string; code: string; name: string }[]).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>);
    const FREQS = ["daily", "weekly", "monthly", "quarterly", "bi_annual", "annual"];
    const fields = (t?: (typeof rows)[number]) => (
      <>
        <input name="equipment" defaultValue={t?.equipment_as_written} required placeholder="Equipment (as on the PM log)" className="input py-2 sm:col-span-2" />
        <select name="frequency" defaultValue={t?.frequency ?? "monthly"} className="input py-2">{FREQS.map((x) => <option key={x} value={x}>{x.replace("_", "-")}</option>)}</select>
        <select name="area" defaultValue={t?.area ?? "U1"} className="input py-2"><option>U1</option><option>U2</option></select>
        <select name="asset_id" defaultValue={t?.asset_id ?? ""} className="input py-2 sm:col-span-2"><option value="">Machine (optional)</option>{aOpts}</select>
        <input name="hours_interval" defaultValue={t?.hours_interval ?? ""} inputMode="numeric" placeholder="Running-hours interval (optional)" className="input py-2 sm:col-span-2" />
        <textarea name="tasks" defaultValue={t?.tasks.join("\n")} rows={Math.min(8, Math.max(3, t?.tasks.length ?? 3))} required placeholder="Tasks, one per line" className="input py-2 text-sm sm:col-span-4" />
      </>
    );
    return (
      <div className="space-y-2">
        <form className="flex flex-wrap gap-2" action="/admin">
          <input type="hidden" name="tab" value="pm" />
          <select name="freq" defaultValue={freq} className="input w-auto py-2"><option value="">All frequencies</option>{FREQS.map((x) => <option key={x} value={x}>{x.replace("_", "-")}</option>)}</select>
          <input name="q" defaultValue={q} placeholder="Search equipment" className="input w-48 py-2" />
          <button className="btn-secondary btn-sm">Show</button>
        </form>
        <p className="text-xs text-gray-500">The PM checklist (CHIENGUTRG08). Untick “in use” to retire a task: it leaves the PM page and its past results are kept. Showing up to 120 tasks; use the filters.</p>
        <details className="card">
          <summary className="cursor-pointer section-title">+ Add a PM Task</summary>
          <ActionForm action={savePmTask} submit="Add task" className="mt-3 grid gap-2 sm:grid-cols-4">{fields()}</ActionForm>
        </details>
        {rows.map((t) => (
          <ActionForm key={t.id} action={savePmTask} className={`card grid gap-2 sm:grid-cols-4 ${t.active ? "" : "opacity-60"}`}>
            <input type="hidden" name="id" value={t.id} />
            <div className="text-xs text-gray-500 sm:col-span-4">#{t.register_sn}</div>
            {fields(t)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={t.active} className="h-5 w-5" /> In use</label>
          </ActionForm>
        ))}
      </div>
    );
  }

  async function Meters() {
    const GRP: [string, string][] = [["air", "Compressed Air Flowmeters"], ["steam", "Steam Flowmeters"], ["gas", "Gas Flowmeters"], ["diesel", "Diesel Flowmeters"],
      ["nitrogen", "Nitrogen Flowmeters"], ["energy", "Energy Meters"], ["water", "Water Flowmeters"], ["borehole", "Boreholes"], ["condensate", "Condensate"]];
    const [{ data }, { data: assets }] = await Promise.all([
      supabase.from("meters").select("id, code, name, grp, unit, kind, asset_id, active").neq("grp", "daily").order("grp").order("sort"),
      supabase.from("assets").select("id, code, name").neq("status", "retired").order("code"),
    ]);
    const rows = (data ?? []) as { id: string; code: string; name: string; grp: string; unit: string | null; kind: string; asset_id: string | null; active: boolean }[];
    const aOpts = ((assets ?? []) as { id: string; code: string; name: string }[]).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>);
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Meters on the Utility Consumption page. Switch a meter on when it is installed (e.g. VAM 4) and off when it is removed; its readings are kept. Steam flowmeters are read in kg (reports show tonnes).</p>
        <details className="card">
          <summary className="cursor-pointer section-title">+ Add a Meter</summary>
          <ActionForm action={saveMeter} submit="Add meter" className="mt-3 grid gap-2 sm:grid-cols-3">
            <input name="code" required placeholder="Code (e.g. A-C13)" className="input py-2 uppercase" />
            <input name="name" required placeholder="Name (e.g. Air Compressor 13 – Air Flow)" className="input py-2 sm:col-span-2" />
            <select name="grp" className="input py-2">{GRP.map(([g, l]) => <option key={g} value={g}>{l}</option>)}</select>
            <input name="unit" placeholder="Unit (m³, kg, L, kWh)" className="input py-2" />
            <select name="kind" className="input py-2"><option value="totaliser">Totaliser (cumulative)</option><option value="rate">Rate (as read)</option></select>
            <select name="asset_id" className="input py-2 sm:col-span-3" defaultValue=""><option value="">Machine (optional)</option>{aOpts}</select>
          </ActionForm>
        </details>
        {GRP.map(([g, label]) => (
          <details key={g} className="card">
            <summary className="cursor-pointer section-title">{label} <span className="text-xs font-normal text-gray-500">({rows.filter((r) => r.grp === g && r.active).length} on)</span></summary>
            <div className="mt-2 divide-y">
              {rows.filter((r) => r.grp === g).map((m) => (
                <ActionForm key={m.id} action={saveMeter} className={`grid gap-2 py-2 sm:grid-cols-6 ${m.active ? "" : "opacity-60"}`}>
                  <input type="hidden" name="id" value={m.id} />
                  <span className="pt-2 text-xs font-semibold text-gray-500">{m.code}</span>
                  <input name="name" defaultValue={m.name} className="input py-2 sm:col-span-2" />
                  <input name="unit" defaultValue={m.unit ?? ""} className="input py-2" aria-label="Unit" />
                  <select name="asset_id" defaultValue={m.asset_id ?? ""} className="input py-2"><option value="">No machine</option>{aOpts}</select>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={m.active} className="h-5 w-5" /> On</label>
                </ActionForm>
              ))}
            </div>
          </details>
        ))}
      </div>
    );
  }

  async function PickLists() {
    const NAMES: [string, string, string[]][] = [
      ["attended_by", "Attended by (downtime)", []], ["production_impact", "Impact on production (downtime)", []],
      ["downtime_status", "Downtime status", ["Open", "Closed"]], ["category_6m", "Root cause category (6M)", []],
      ["action_type", "RCA action type", []], ["rca_status", "RCA status", ["Not Started", "Completed - Pending Verification", "Closed - Verified Effective"]],
    ];
    const { data } = await supabase.from("lists").select("list_name, value, sort, active").in("list_name", NAMES.map((n) => n[0])).order("sort");
    const rows = (data ?? []) as { list_name: string; value: string; sort: number; active: boolean }[];
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Choices offered on the forms. Values already used on records are not renamed: hide an old value and add the new one. Values the app relies on are locked.</p>
        {NAMES.map(([key, label, locked]) => (
          <details key={key} className="card">
            <summary className="cursor-pointer section-title">{label}</summary>
            <ul className="mt-2 divide-y">
              {rows.filter((r) => r.list_name === key).map((r) => (
                <li key={r.value} className="py-1.5">
                  {locked.includes(r.value) ? <span className="text-sm">{r.value} <span className="text-xs text-gray-500">(locked)</span></span> : (
                    <ActionForm action={saveListItem} submit="Save" className="flex flex-wrap items-center gap-2 text-sm">
                      <input type="hidden" name="list_name" value={key} /><input type="hidden" name="value" value={r.value} /><input type="hidden" name="existing" value="1" />
                      <span className={`min-w-0 flex-1 ${r.active ? "" : "text-gray-400 line-through"}`}>{r.value}</span>
                      <input name="sort" defaultValue={r.sort} inputMode="numeric" className="input w-16 py-1" aria-label="Order" />
                      <label className="flex items-center gap-1"><input type="checkbox" name="active" defaultChecked={r.active} className="h-5 w-5" /> Shown</label>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
            <ActionForm action={saveListItem} submit="Add" className="mt-2 flex flex-wrap items-center gap-2">
              <input type="hidden" name="list_name" value={key} />
              <input name="value" required minLength={2} placeholder="New value" className="input max-w-sm py-2" />
            </ActionForm>
          </details>
        ))}
      </div>
    );
  }

  async function CleaningSetup() {
    const [{ data: z }, { data: a }] = await Promise.all([
      supabase.from("cleaning_zones").select("id, day_of_week, area, name, active").order("day_of_week"),
      supabase.from("cleaning_activities").select("id, sort, name, active").order("sort"),
    ]);
    const zones = (z ?? []) as { id: number; day_of_week: number; area: string; name: string; active: boolean }[];
    const acts = (a ?? []) as { id: number; sort: number; name: string; active: boolean }[];
    const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const freeDays = [1, 2, 3, 4, 5, 6, 7].filter((d) => !zones.some((x) => x.day_of_week === d));
    return (
      <div className="space-y-3">
        <section className="card space-y-2">
          <h2 className="section-title">Zones (One per Weekday)</h2>
          {zones.map((x) => (
            <ActionForm key={x.id} action={saveCleaningZone} className={`grid gap-2 border-t pt-2 sm:grid-cols-6 ${x.active ? "" : "opacity-60"}`}>
              <input type="hidden" name="id" value={x.id} /><input type="hidden" name="day" value={x.day_of_week} />
              <b className="pt-2 text-sm">{DAYS[x.day_of_week]}</b>
              <select name="area" defaultValue={x.area} className="input py-2"><option>U1</option><option>U2</option></select>
              <input name="name" defaultValue={x.name} className="input py-2 sm:col-span-3" />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={x.active} className="h-5 w-5" /> In use</label>
            </ActionForm>
          ))}
          {freeDays.length > 0 && (
            <ActionForm action={saveCleaningZone} submit="Add zone" className="grid gap-2 border-t pt-2 sm:grid-cols-6">
              <select name="day" className="input py-2">{freeDays.map((d) => <option key={d} value={d}>{DAYS[d]}</option>)}</select>
              <select name="area" className="input py-2"><option>U1</option><option>U2</option></select>
              <input name="name" required placeholder="Zone and equipment to clean" className="input py-2 sm:col-span-4" />
            </ActionForm>
          )}
        </section>
        <section className="card space-y-2">
          <h2 className="section-title">Activities (Done in Every Zone)</h2>
          {acts.map((x) => (
            <ActionForm key={x.id} action={saveCleaningActivity} className={`flex flex-wrap items-center gap-2 border-t pt-2 ${x.active ? "" : "opacity-60"}`}>
              <input type="hidden" name="id" value={x.id} />
              <input name="name" defaultValue={x.name} className="input min-w-0 flex-1 py-2" />
              <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="active" defaultChecked={x.active} className="h-5 w-5" /> In use</label>
            </ActionForm>
          ))}
          <ActionForm action={saveCleaningActivity} submit="Add activity" className="flex flex-wrap items-center gap-2 border-t pt-2">
            <input name="name" required placeholder="New activity" className="input min-w-0 flex-1 py-2" />
          </ActionForm>
        </section>
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

/** Work pattern (day / night shift, or Mon–Fri office hours) and which e-mail alerts the person gets. */
function PatternFields({ pattern, alerts, disabled }: { pattern: string; alerts: string[]; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm sm:col-span-4">
      <select name="pattern" defaultValue={pattern} disabled={disabled} className="input w-auto py-2">
        <option value="">Shift worker (day or night)</option>
        <option value="day">Shift worker: usually day</option>
        <option value="night">Shift worker: usually night</option>
        <option value="office">Office hours (Mon–Fri 08:00–17:00)</option>
      </select>
      <label className="flex items-center gap-1" title="PM, follow-ups, AMC, calibration, open downtime and RCA flags, e-mailed during office hours">
        <input type="checkbox" name="alerts" value="maintenance" defaultChecked={alerts.includes("maintenance")} disabled={disabled} /> Maintenance alerts (office hours)</label>
      <label className="flex items-center gap-1" title="Daily compliance summary at 07:00">
        <input type="checkbox" name="alerts" value="digest" defaultChecked={alerts.includes("digest")} disabled={disabled} /> Daily digest e-mail</label>
    </div>
  );
}
