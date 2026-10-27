import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse } from "@/lib/csv";
import { monthDays } from "@/lib/consumption";

/** Every meter reading of a month with the daily use (opens in Excel). */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const month = req.nextUrl.searchParams.get("month") ?? "";
  if (!/^\d{4}-\d{2}$/.test(month)) return new NextResponse("month=YYYY-MM", { status: 400 });
  const days = monthDays(month);
  const { data } = await supabase.from("meter_usage")
    .select("code, name, grp, unit, kind, read_date, value, prev_date, prev_value, used, days, is_reset, comment, is_demo")
    .gte("read_date", days[0]).lte("read_date", days[days.length - 1]).order("grp").order("code").order("read_date").limit(20000);
  type R = Record<string, unknown>;
  const rows = ((data ?? []) as R[]).map((r) => [r.read_date, r.grp, r.code, r.name, r.unit, r.kind, r.value, r.prev_date, r.prev_value,
    r.used, r.days, r.is_reset ? "reset" : "", r.comment, r.is_demo ? "DEMO" : ""]);
  return csvResponse(`CHI_Utility_consumption_${month}.csv`,
    ["Date (07:00)", "Sheet", "Meter code", "Meter", "Unit", "Kind", "Reading", "Previous date", "Previous reading", "Use", "Days", "Reset", "Comment", "Demo"], rows);
}
