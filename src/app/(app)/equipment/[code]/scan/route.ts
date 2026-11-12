import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Opened by scanning a machine's PM verification label: records the scan, then shows the machine's page. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();
  const { error } = await supabase.rpc("record_asset_scan", { p_code: decodeURIComponent(code), p_secret: request.nextUrl.searchParams.get("s") ?? "" });
  const dest = new URL(`/equipment/${code}`, request.nextUrl.origin);
  if (error) dest.searchParams.set("scan_error", error.message); else dest.searchParams.set("scanned", "1");
  return NextResponse.redirect(dest);
}
