import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { ActionForm } from "@/components/ActionForm";
import { acknowledge } from "./actions";

export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { escalation: "Escalation", digest: "Daily digest", alert: "Alert", report: "Report" };

interface Note { id: string; created_at: string; kind: string; subject: string; body: string; link: string | null; acknowledged_at: string | null }

/** Messages for me: scheduled reports, escalations and digests (the in-app copy of what is also e-mailed). */
export default async function InboxPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, created_at, kind, subject, body, link, acknowledged_at")
    .eq("recipient_id", profile.id).or("channel.eq.in_app,kind.neq.report").order("created_at", { ascending: false }).limit(100);
  const notes = (data ?? []) as Note[];
  const unread = notes.filter((n) => !n.acknowledged_at);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="page-title">Inbox</h1>
          <p className="page-sub">Scheduled reports, escalations and digests sent to you (the same messages go by e-mail once e-mail is switched on). {unread.length} unread.</p>
        </div>
        {unread.length > 1 && (
          <ActionForm action={acknowledge} submit="Mark all as read">{unread.map((n) => <input key={n.id} type="hidden" name="id" value={n.id} />)}</ActionForm>
        )}
      </div>
      {notes.length === 0 && <p className="card text-sm text-gray-500">No messages yet.</p>}
      <ul className="space-y-2">
        {notes.map((n) => (
          <li key={n.id} className={`card space-y-1 ${n.acknowledged_at ? "opacity-70" : "border-brand-blue"}`}>
            <div className="flex flex-wrap justify-between gap-2 text-xs text-gray-500">
              <span className="font-semibold uppercase">{KIND[n.kind] ?? n.kind}</span><span>{formatLagos(n.created_at)}</span>
            </div>
            <b className="text-sm">{n.subject}</b>
            <p className="whitespace-pre-line text-sm text-gray-700">{n.body}</p>
            <div className="flex flex-wrap items-center gap-3">
              {n.link && (n.link.startsWith("/reports/deck")
                ? <a href={n.link} className="btn-secondary px-3 py-1 text-sm">Download</a>
                : <Link href={n.link} className="btn-secondary px-3 py-1 text-sm">Open</Link>)}
              {!n.acknowledged_at && (
                <ActionForm action={acknowledge} submit="Mark as read"><input type="hidden" name="id" value={n.id} /></ActionForm>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
