import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { StatTile } from "@/components/BarList";
import { GridList, GridRow } from "@/components/GridList";
import { ActionForm } from "@/components/ActionForm";
import { saveJob, saveOrder, voidJobRecord } from "./actions";

export const dynamic = "force-dynamic";

const STATUSES = ["Pending", "Request for offer", "Approved in BC", "PO issued", "CAPEX PO issued", "Suspended", "Abandoned"];
const EXECUTION = ["Pending", "In progress", "Done"];
const OPEN = new Set(["Pending", "Request for offer", "Approved in BC"]);
const STATUS_CLS: Record<string, string> = {
  "PO issued": "bg-blue-50 text-brand-blue", "CAPEX PO issued": "bg-blue-50 text-brand-blue",
  Suspended: "bg-gray-100 text-gray-600", Abandoned: "bg-gray-100 text-gray-500 line-through",
};

interface Job {
  id: string; sn: number | null; request_date: string | null; cs_number: string | null; description: string; brk_number: string | null;
  status: string; po_number: string | null; po_value_ngn: number | null; vendor: string | null; execution: string | null;
  jcc_completed: boolean; payment_completed: boolean; remarks: string | null; recorded_by_type: string;
}
interface Order {
  id: string; sn: number | null; order_date: string | null; mrs_number: string | null; items: string; prn_number: string | null;
  status: string; po_number: string | null; po_value_ngn: number | null; vendor: string | null; received_date: string | null; remarks: string | null;
}

const ngn = (v: number | null) => (v === null ? "—" : `₦${Number(v).toLocaleString("en-NG", { maximumFractionDigits: 0 })}`);

function stage(j: Job): string {
  if (j.status === "Suspended" || j.status === "Abandoned") return j.status;
  if (OPEN.has(j.status)) return "Awaiting PO";
  if (j.execution !== "Done") return "Job in progress";
  if (!j.jcc_completed) return "Awaiting JCC";
  if (!j.payment_completed) return "Awaiting payment";
  return "Closed";
}

export default async function JobsPage({ searchParams }: { searchParams: Promise<{ tab?: string; show?: string; q?: string }> }) {
  const profile = await requireProfile();
  const sp = await searchParams;
  const tab = sp.tab === "orders" ? "orders" : "jobs";
  const show = sp.show ?? "open";
  const q = (sp.q ?? "").trim().toLowerCase();
  const canEdit = profile.active && ["engineer", "shift_manager", "section_manager", "admin"].includes(profile.role);

  const supabase = await createClient();
  const [{ data: js }, { data: os }] = await Promise.all([
    supabase.from("job_requests").select("id, sn, request_date, cs_number, description, brk_number, status, po_number, po_value_ngn, vendor, execution, jcc_completed, payment_completed, remarks, recorded_by_type")
      .is("voided_at", null).order("request_date", { ascending: false, nullsFirst: false }).order("sn", { ascending: false }),
    supabase.from("item_orders").select("id, sn, order_date, mrs_number, items, prn_number, status, po_number, po_value_ngn, vendor, received_date, remarks")
      .is("voided_at", null).order("order_date", { ascending: false, nullsFirst: false }),
  ]);
  const jobs = (js ?? []) as Job[];
  const orders = (os ?? []) as Order[];
  const year = new Date().getFullYear();
  const poThisYear = jobs.filter((j) => (j.request_date ?? "").startsWith(String(year))).reduce((s, j) => s + Number(j.po_value_ngn ?? 0), 0);
  const counts = {
    awaitingPo: jobs.filter((j) => stage(j) === "Awaiting PO").length,
    inProgress: jobs.filter((j) => stage(j) === "Job in progress").length,
    awaitingClose: jobs.filter((j) => stage(j) === "Awaiting JCC" || stage(j) === "Awaiting payment").length,
  };
  const match = (text: string) => !q || text.toLowerCase().includes(q);
  const shownJobs = jobs.filter((j) => (show === "all" || !["Closed", "Abandoned"].includes(stage(j)))
    && match(`${j.description} ${j.cs_number} ${j.brk_number} ${j.po_number} ${j.vendor}`));
  const shownOrders = orders.filter((o) => (show === "all" || !o.received_date) && match(`${o.items} ${o.mrs_number} ${o.po_number} ${o.vendor}`));
  const link = (o: Record<string, string>) => `/jobs?${new URLSearchParams({ tab, show, ...(q ? { q } : {}), ...o })}`;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Job requests &amp; item orders</h1>
        <p className="page-sub">From request to PO, execution, job completion certificate (JCC) and payment</p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Awaiting PO" value={String(counts.awaitingPo)} tone={counts.awaitingPo ? "warn" : "default"} />
        <StatTile label="Jobs in progress" value={String(counts.inProgress)} />
        <StatTile label="Awaiting JCC / payment" value={String(counts.awaitingClose)} />
        <StatTile label={`PO value ${year}`} value={ngn(poThisYear)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {[["jobs", `Job requests (${jobs.length})`], ["orders", `Item orders (${orders.length})`]].map(([k, l]) => (
            <Link key={k} href={link({ tab: k })} className={`tab ${tab === k ? "tab-on" : ""}`}>{l}</Link>
          ))}
        </div>
        <form className="flex gap-2" action="/jobs">
          <input type="hidden" name="tab" value={tab} />
          <select name="show" defaultValue={show} className="input w-auto py-2">
            <option value="open">Open only</option><option value="all">All</option>
          </select>
          <input name="q" defaultValue={sp.q} placeholder="Search" className="input w-40 py-2" />
          <button className="btn-secondary btn-sm">Go</button>
        </form>
      </div>

      {tab === "jobs" ? (
        <div className="space-y-3">
          <GridList cols="minmax(0,2.4fr) 6.5rem minmax(0,1.2fr) minmax(0,1.2fr) 8rem minmax(0,1fr)"
            head={[{ label: "Job" }, { label: "Requested" }, { label: "CS / BRK no." }, { label: "PO / vendor" }, { label: "Status" }, { label: "Stage" }]}>
            {shownJobs.map((j) => (
              <GridRow key={j.id} cells={[
                { content: <b className="font-medium">{j.description}</b> },
                { content: j.request_date ?? "—", muted: true },
                { content: [j.cs_number, j.brk_number].filter(Boolean).join(" · ") || "—", muted: true },
                { content: j.po_number ? <>{j.po_number} · {ngn(j.po_value_ngn)}{j.vendor && <span className="block">{j.vendor}</span>}</> : j.vendor ?? "—", muted: true },
                { content: <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${STATUS_CLS[j.status] ?? "bg-amber-50 text-warn"}`}>{j.status}</span> },
                { content: <>{stage(j)}{j.recorded_by_type === "logger" && <span className="block text-xs text-gray-400">from Excel</span>}</>, muted: true },
              ]}>
                {j.remarks && <p className="mb-2 text-sm text-gray-600">{j.remarks}</p>}
                {canEdit ? <JobForm job={j} /> : !j.remarks && <p className="text-sm text-gray-500">No remarks.</p>}
              </GridRow>
            ))}
          </GridList>
          {canEdit && (
            <details className="card">
              <summary className="cursor-pointer font-semibold">+ New job request</summary>
              <JobForm />
            </details>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <GridList cols="minmax(0,2.4fr) 6.5rem minmax(0,1fr) minmax(0,1.4fr) 8rem"
            head={[{ label: "Items" }, { label: "Ordered" }, { label: "MRS no." }, { label: "PO / vendor" }, { label: "Status" }]}>
            {shownOrders.map((o) => (
              <GridRow key={o.id} cells={[
                { content: <b className="whitespace-pre-line font-medium">{o.items}</b> },
                { content: o.order_date ?? "—", muted: true },
                { content: o.mrs_number ?? "—", muted: true },
                { content: o.po_number ? <>{o.po_number} · {ngn(o.po_value_ngn)}{o.vendor && <span className="block">{o.vendor}</span>}</> : o.vendor ?? "—", muted: true },
                { content: <span className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${o.received_date ? "bg-green-100 text-ok" : STATUS_CLS[o.status] ?? "bg-amber-50 text-warn"}`}>{o.received_date ? "Received" : o.status}</span> },
              ]}>
                {o.remarks && <p className="mb-2 text-sm text-gray-600">{o.remarks}</p>}
                {canEdit ? <OrderForm order={o} /> : !o.remarks && <p className="text-sm text-gray-500">No remarks.</p>}
              </GridRow>
            ))}
          </GridList>
          {canEdit && (
            <details className="card">
              <summary className="cursor-pointer font-semibold">+ New item order</summary>
              <OrderForm />
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="text-xs text-gray-600">{label}</span>{children}</label>;
}

function JobForm({ job }: { job?: Job }) {
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <ActionForm action={saveJob} submit={job ? "Save changes" : "Add job request"} className="grid gap-2 sm:grid-cols-3">
        {job && <input type="hidden" name="id" value={job.id} />}
        <Field label="Date"><input type="date" name="request_date" defaultValue={job?.request_date ?? ""} className="input" /></Field>
        <Field label="CS number"><input name="cs_number" defaultValue={job?.cs_number ?? ""} className="input" /></Field>
        <Field label="BRK number"><input name="brk_number" defaultValue={job?.brk_number ?? ""} className="input" /></Field>
        <div className="sm:col-span-3"><Field label="Job description"><textarea name="description" required rows={2} defaultValue={job?.description ?? ""} className="input" /></Field></div>
        <Field label="Status"><select name="status" defaultValue={job?.status ?? "Pending"} className="input">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="PO number"><input name="po_number" defaultValue={job?.po_number ?? ""} className="input" /></Field>
        <Field label="PO value (NGN)"><input name="po_value_ngn" inputMode="decimal" defaultValue={job?.po_value_ngn ?? ""} className="input" /></Field>
        <Field label="Vendor"><input name="vendor" defaultValue={job?.vendor ?? ""} className="input" /></Field>
        <Field label="Job execution"><select name="execution" defaultValue={job?.execution ?? ""} className="input"><option value="">—</option>{EXECUTION.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <div className="flex items-end gap-4 pb-3 text-sm">
          <label className="flex items-center gap-1"><input type="checkbox" name="jcc_completed" defaultChecked={job?.jcc_completed} className="h-5 w-5" /> JCC done</label>
          <label className="flex items-center gap-1"><input type="checkbox" name="payment_completed" defaultChecked={job?.payment_completed} className="h-5 w-5" /> Paid</label>
        </div>
        <div className="sm:col-span-3"><Field label="Remarks / vendors in BRK"><input name="remarks" defaultValue={job?.remarks ?? ""} className="input" /></Field></div>
      </ActionForm>
      {job && (
        <ActionForm action={voidJobRecord} submit="Void" className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="table" value="job_requests" /><input type="hidden" name="id" value={job.id} />
          <input name="reason" required minLength={5} placeholder="Reason to void (entered by mistake, duplicate…)" className="input max-w-md" />
        </ActionForm>
      )}
    </div>
  );
}

function OrderForm({ order }: { order?: Order }) {
  return (
    <div className="mt-3 space-y-3 border-t pt-3">
      <ActionForm action={saveOrder} submit={order ? "Save changes" : "Add item order"} className="grid gap-2 sm:grid-cols-3">
        {order && <input type="hidden" name="id" value={order.id} />}
        <Field label="Date"><input type="date" name="order_date" defaultValue={order?.order_date ?? ""} className="input" /></Field>
        <Field label="MRS number"><input name="mrs_number" defaultValue={order?.mrs_number ?? ""} className="input" /></Field>
        <Field label="PRN number"><input name="prn_number" defaultValue={order?.prn_number ?? ""} className="input" /></Field>
        <div className="sm:col-span-3"><Field label="Items"><textarea name="items" required rows={3} defaultValue={order?.items ?? ""} className="input" /></Field></div>
        <Field label="Status"><select name="status" defaultValue={order?.status ?? "Pending"} className="input">{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="PO number"><input name="po_number" defaultValue={order?.po_number ?? ""} className="input" /></Field>
        <Field label="PO value (NGN)"><input name="po_value_ngn" inputMode="decimal" defaultValue={order?.po_value_ngn ?? ""} className="input" /></Field>
        <Field label="Vendor"><input name="vendor" defaultValue={order?.vendor ?? ""} className="input" /></Field>
        <Field label="Received on"><input type="date" name="received_date" defaultValue={order?.received_date ?? ""} className="input" /></Field>
        <Field label="Remarks"><input name="remarks" defaultValue={order?.remarks ?? ""} className="input" /></Field>
      </ActionForm>
      {order && (
        <ActionForm action={voidJobRecord} submit="Void" className="flex flex-wrap items-center gap-2 text-sm">
          <input type="hidden" name="table" value="item_orders" /><input type="hidden" name="id" value={order.id} />
          <input name="reason" required minLength={5} placeholder="Reason to void" className="input max-w-md" />
        </ActionForm>
      )}
    </div>
  );
}
