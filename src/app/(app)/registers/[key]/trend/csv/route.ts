import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadTrend } from "@/lib/data/trend";
import { formatLagos } from "@/lib/time";

/** CSV of the readings shown on the trend page (opens in Excel). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });

  const { key } = await params;
  const sp = req.nextUrl.searchParams;
  const t = await loadTrend(key, { field: sp.get("field") ?? undefined, asset: sp.get("asset") ?? undefined, days: sp.get("days") ?? undefined });
  if (!t || !t.field) return new NextResponse("Not found", { status: 404 });

  const p = t.field.parameter;
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Reading for (Lagos)", "Register", "Document no", "Equipment", "Parameter", "Value", "Unit",
    "Std min", "Std max", "Status", "Comment", "Recorded by", "Recorded at (Lagos)", "Demo"];
  const lines = [header.join(",")];
  for (const r of t.points) {
    lines.push([
      formatLagos(r.at), t.detail.register.title, t.detail.register.document_no, t.asset?.code ?? "", t.field.label,
      r.value ?? r.text, p.unit, p.std_min, p.std_max, r.status, r.comment, r.recordedBy, formatLagos(r.recordedAt),
      r.isDemo ? "DEMO" : "",
    ].map(esc).join(","));
  }
  const name = `${t.detail.register.document_no}_${t.field.label}_${t.days}d.csv`.replace(/[^\w.-]+/g, "_");
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}"` },
  });
}
