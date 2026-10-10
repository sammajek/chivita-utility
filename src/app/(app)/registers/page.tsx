import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { logDateOf } from "@/lib/registers";
import type { Register } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function RegistersPage() {
  await requireProfile();
  const supabase = await createClient();
  const today = logDateOf(new Date());
  const [{ data: regs }, { data: done }] = await Promise.all([
    supabase.from("registers").select("id, key, area, document_no, title, description, monitor, sort").eq("active", true).order("area").order("sort"),
    supabase.from("readings").select("register_id").eq("log_date", today).is("voided_at", null).limit(20000),
  ]);
  const counts = new Map<string, number>();
  for (const r of done ?? []) counts.set(r.register_id, (counts.get(r.register_id) ?? 0) + 1);

  const byArea: Record<string, Register[]> = {};
  for (const r of (regs ?? []) as Register[]) (byArea[r.area] ??= []).push(r);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Registers</h1>
        <p className="text-sm text-gray-600">Digital log sheets. Log date {today} (07:00 to 07:00).</p>
      </div>
      {Object.entries(byArea).map(([area, list]) => (
        <section key={area}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
            {area === "U1" ? "Utility 1" : "Utility 2"}
          </h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {list.map((r) => (
              <li key={r.id}>
                <Link href={`/registers/${r.key}`} className="card flex items-center justify-between gap-3 hover:border-brand-blue">
                  <div>
                    <div className="font-semibold">{r.title}</div>
                    <div className="text-xs text-gray-500">{r.document_no}</div>
                  </div>
                  <div className="text-right text-xs text-gray-500">
                    <div>{counts.get(r.id) ?? 0} values today</div>
                    {r.monitor && <div className="text-brand-blue">Monitored</div>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
