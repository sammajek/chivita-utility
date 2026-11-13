import { can, requireCap } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { KeyForm, UploadForm } from "./Forms";

export const dynamic = "force-dynamic";

interface Logger { id: string; name: string; description: string | null; active: boolean; last_seen_at: string | null; area: string | null }
interface Raw { id: number; ts: string; value_num: number | null; value_text: string | null; placed: string; note: string | null;
  logger: { name: string } | null; asset: { code: string } | null; parameter: { name: string } | null; meter: { code: string } | null }

const PLACED: Record<string, string> = { slot: "Register slot", meter: "07:00 meter reading", stored: "Logger data", rejected: "Rejected" };

export default async function LoggersPage() {
  const profile = await requireCap("engineer_tasks");
  const supabase = await createClient();
  const [{ data: lg }, { data: raw }] = await Promise.all([
    supabase.from("loggers").select("id, name, description, active, last_seen_at, area").order("name"),
    supabase.from("logger_data").select("id, ts, value_num, value_text, placed, note, logger:loggers(name), asset:assets(code), parameter:parameters(name), meter:meters(code)")
      .order("received_at", { ascending: false }).limit(50),
  ]);
  const loggers = (lg ?? []) as Logger[];
  const rows = (raw ?? []) as unknown as Raw[];
  return (
    <div className="space-y-4">
      <div>
        <h1 className="page-title">Loggers &amp; Data Import</h1>
        <p className="page-sub">Energy meters, flowmeters, SCADA / THERMAX exports. Every value is kept. A value within 15 minutes of a register reading time fills that slot
          (tagged to the logger, checked against the standard and flagged as usual); a meter value between 06:45 and 07:15 becomes that day’s 07:00 consumption reading.</p>
      </div>

      <section className="card space-y-2">
        <h2 className="font-semibold">Loggers</h2>
        <ul className="divide-y text-sm">
          {loggers.map((l) => (
            <li key={l.id} className="flex flex-wrap justify-between gap-2 py-1">
              <span><b>{l.name}</b>{l.area ? ` · ${l.area}` : ""}{l.description ? <span className="text-gray-500"> · {l.description}</span> : null}{!l.active && <span className="text-crit"> · inactive</span>}</span>
              <span className="text-xs text-gray-500">{l.last_seen_at ? `last data ${formatLagos(l.last_seen_at)}` : "no data yet"}</span>
            </li>
          ))}
        </ul>
        {can(profile, "admin_tasks") && (<><h3 className="pt-2 text-sm font-semibold">Add a Logger or Issue a New Key (Admin)</h3><KeyForm /></>)}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Upload a Logger’s CSV Export</h2>
        <UploadForm loggers={loggers.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }))} />
      </section>

      <details className="card text-sm">
        <summary className="cursor-pointer font-semibold">For IT / the Logger Supplier: How a Device Sends Data</summary>
        <pre className="mt-2 overflow-x-auto whitespace-pre rounded bg-gray-50 p-2 text-xs">{`POST https://<app address>/api/logger/readings
Authorization: Bearer <logger key>
Content-Type: application/json

{ "readings": [
  { "asset_code": "CMP-03", "parameter": "Running Hours", "value": 4321, "timestamp": "2026-11-03T09:05:00+01:00" },
  { "meter_code": "E-C3", "value": 120000, "timestamp": "2026-11-03T07:02:00+01:00" }
] }`}</pre>
        <p className="mt-2 text-xs text-gray-600">Up to 5000 rows per request; timestamps in ISO format (with +01:00 for Lagos). asset_code is the equipment code (or a name in its alias list), parameter is the name
          as on the register, meter_code is the code on the Consumption page. The reply lists how each row was used and why any were rejected.</p>
      </details>

      <section className="card overflow-x-auto">
        <h2 className="mb-2 font-semibold">Latest Logger Data</h2>
        {rows.length === 0 ? <p className="text-sm text-gray-500">Nothing received yet.</p> : (
          <table className="data-table min-w-[640px]">
            <thead><tr><th>Time</th><th>Logger</th><th>Point</th><th className="num">Value</th><th>Used as</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td>{formatLagos(r.ts)}</td><td>{r.logger?.name}</td>
                <td>{r.meter?.code ?? `${r.asset?.code ?? "?"} · ${r.parameter?.name ?? "?"}`}</td>
                <td className="num">{r.value_num ?? r.value_text}</td>
                <td className={r.placed === "rejected" ? "text-crit" : ""}>{PLACED[r.placed]}{r.note ? `: ${r.note}` : ""}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}
