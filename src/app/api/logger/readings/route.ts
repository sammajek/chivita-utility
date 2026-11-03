import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Logger import. POST JSON with header "Authorization: Bearer <logger key>":
 *   { "readings": [ { "asset_code": "CMP-03", "parameter": "Running Hours", "value": 4321, "timestamp": "2026-11-03T09:05:00+01:00" },
 *                   { "meter_code": "E-C3", "value": 120000, "timestamp": "2026-11-03T07:02:00+01:00" } ] }
 * Up to 5000 rows per request. The reply says how many filled register slots / 07:00 meter readings, were stored only,
 * or were rejected (with reasons).
 */
export async function POST(req: NextRequest) {
  const key = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!key) return NextResponse.json({ error: "Missing logger key (Authorization: Bearer …)." }, { status: 401 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  const rows = Array.isArray(body) ? body : (body as { readings?: unknown })?.readings;
  if (!Array.isArray(rows)) return NextResponse.json({ error: 'Send { "readings": [ … ] }.' }, { status: 400 });
  if (rows.length > 5000) return NextResponse.json({ error: "At most 5000 rows per request." }, { status: 413 });

  const supabase = createClient(supabaseUrl, supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await supabase.rpc("logger_ingest", { p_key: key, p_rows: rows });
  if (error) {
    const status = error.code === "28000" ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data);
}
