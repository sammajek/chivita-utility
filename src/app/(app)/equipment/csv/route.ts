import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { csvResponse } from "@/lib/csv";
import { lagosDate } from "@/lib/time";

/** The equipment list with PM code, PM schedule and specifications (opens in Excel). */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse("Sign in first.", { status: 401 });
  const sp = req.nextUrl.searchParams;
  let q = supabase
    .from("assets")
    .select("code, name, area, make, model, serial_no, capacity, rated_output, rated_unit, criticality, location, year_installed, pm_code, specs, op_state, op_reason, category:asset_categories(name), pm_tasks(frequency, register_sn, active)")
    .neq("status", "retired").order("code");
  const area = sp.get("area");
  if (area === "U1" || area === "U2") q = q.eq("area", area);
  const { data } = await q;
  type R = Record<string, unknown> & { category: { name: string } | null; pm_tasks: { frequency: string; register_sn: number; active: boolean }[] };
  const rows = ((data ?? []) as unknown as R[]).map((a) => [
    a.code, a.name, a.category?.name, a.area, a.make, a.model, a.serial_no, a.capacity,
    a.rated_output != null ? `${a.rated_output} ${a.rated_unit ?? ""}`.trim() : "", a.criticality, a.location, a.year_installed,
    a.pm_code, a.pm_tasks.filter((t) => t.active).map((t) => `${t.frequency} S/N ${t.register_sn}`).join("; "),
    a.op_state, a.op_reason, a.specs,
  ]);
  return csvResponse(`CHI_Utility_equipment_${lagosDate(new Date())}.csv`,
    ["Code", "Name", "Category", "Area", "Make", "Model", "Serial no", "Capacity", "Rated output", "Criticality", "Location",
     "Year installed", "PM code", "PM schedule (CHIENGUTRG08)", "State", "State reason", "Specifications"], rows);
}
