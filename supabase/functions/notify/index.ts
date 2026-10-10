// Supabase Edge Function: sends queued notifications.
//
// Nothing is sent until the owner approves an email provider and an admin sets
// the secrets (Supabase dashboard → Edge Functions → Secrets):
//   EMAIL_PROVIDER = "resend"        (only provider implemented; M365 SMTP can be added behind the same interface)
//   RESEND_API_KEY = "re_…"
//   EMAIL_FROM     = "CHI Utility <alerts@your-domain>"
//   NOTIFY_TOKEN   = a long random string; the caller (pg_cron / pg_net) sends it as "Authorization: Bearer <token>"
// WhatsApp is a stub until the WhatsApp Business number and templates are approved.
//
// Deploy: supabase functions deploy notify --no-verify-jwt
import { createClient } from "npm:@supabase/supabase-js@2.117.3";

interface Notification {
  id: string;
  channel: "email" | "whatsapp" | "in_app";
  recipient_email: string | null;
  recipient_phone: string | null;
  subject: string;
  body: string;
}

interface Notifier {
  send(n: Notification): Promise<void>;
}

class ResendEmail implements Notifier {
  constructor(private key: string, private from: string) {}
  async send(n: Notification) {
    if (!n.recipient_email) throw new Error("No email address on the profile");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [n.recipient_email], subject: n.subject, text: n.body }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  }
}

class WhatsAppStub implements Notifier {
  send(): Promise<void> {
    throw new Error("WhatsApp not configured yet");
  }
}

Deno.serve(async (req) => {
  const token = Deno.env.get("NOTIFY_TOKEN");
  if (!token || req.headers.get("Authorization") !== `Bearer ${token}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const provider = Deno.env.get("EMAIL_PROVIDER");
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  if (provider !== "resend" || !key || !from) {
    return Response.json({ sent: 0, note: "Email provider not configured; notifications stay queued." });
  }

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const notifiers: Record<string, Notifier> = { email: new ResendEmail(key, from), whatsapp: new WhatsAppStub() };

  const { data, error } = await db
    .from("notifications")
    .select("id, channel, recipient_email, recipient_phone, subject, body")
    .eq("status", "queued")
    .in("channel", ["email", "whatsapp"])
    .order("created_at")
    .limit(50);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let sent = 0;
  let failed = 0;
  for (const n of (data ?? []) as Notification[]) {
    try {
      await notifiers[n.channel].send(n);
      await db.from("notifications").update({ status: "sent", sent_at: new Date().toISOString(), error: null }).eq("id", n.id);
      sent++;
    } catch (e) {
      await db.from("notifications").update({ status: "failed", error: String(e).slice(0, 500) }).eq("id", n.id);
      failed++;
    }
  }
  return Response.json({ sent, failed });
});
