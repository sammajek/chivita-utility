import Link from "next/link";
import { notFound } from "next/navigation";
import { requireProfile } from "@/lib/auth";
import { loadTrend, TREND_DAYS } from "@/lib/data/trend";
import { describeStandard, STATUS_LABEL } from "@/lib/evaluate";
import { formatLagos } from "@/lib/time";
import { TrendChart } from "@/components/TrendChart";
import { StatusBadge } from "@/components/StatusBadge";
import type { Status } from "@/lib/types";

export const dynamic = "force-dynamic";

type Search = { field?: string; asset?: string; days?: string };

export default async function TrendPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Search> }) {
  await requireProfile();
  const { key } = await params;
  const sp = await searchParams;
  const t = await loadTrend(key, sp);
  if (!t) notFound();
  const { detail, choices, field, asset, days, points } = t;
  const p = field?.parameter;
  const numeric = points.filter((d) => d.value !== null);
  const inSpec = points.filter((d) => d.status === "ok").length;
  const judged = points.filter((d) => d.status !== "info").length;
  const q = new URLSearchParams({ ...(field ? { field: field.id } : {}), ...(asset ? { asset: asset.id } : {}), days: String(days) });
  const stats = numeric.length
    ? {
        min: Math.min(...numeric.map((d) => d.value!)),
        max: Math.max(...numeric.map((d) => d.value!)),
        avg: numeric.reduce((s, d) => s + d.value!, 0) / numeric.length,
      }
    : null;

  return (
    <div className="space-y-4">
      <div>
        <Link href={`/registers/${key}`} className="text-sm text-brand-blue">← {detail.register.title}</Link>
        <h1 className="text-xl font-bold">Trend</h1>
        <p className="text-sm text-gray-600">{detail.register.document_no}</p>
      </div>

      <form className="card grid gap-3 sm:grid-cols-4" action={`/registers/${key}/trend`}>
        {detail.assets.length > 0 && (
          <label className="block">
            <span className="text-xs font-medium text-gray-600">Equipment</span>
            <select name="asset" defaultValue={asset?.id} className="input">
              {detail.assets.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </select>
          </label>
        )}
        <label className="block sm:col-span-2">
          <span className="text-xs font-medium text-gray-600">Parameter</span>
          <select name="field" defaultValue={field?.id} className="input">
            {choices.map((c) => (
              <option key={c.field.id} value={c.field.id}>{c.section} · {c.field.label}</option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-gray-600">Period</span>
          <select name="days" defaultValue={String(days)} className="input">
            {TREND_DAYS.map((d) => <option key={d} value={d}>{d === 1 ? "Last 24 hours" : `Last ${d} days`}</option>)}
          </select>
        </label>
        <button className="btn-secondary sm:col-span-4">Show</button>
      </form>

      {field && p && (
        <div className="card space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-semibold">{field.label}{asset ? ` · ${asset.code}` : ""}</h2>
              <p className="text-xs text-gray-500">
                Standard: {describeStandard(p, p.unit)}
                {p.needs_review && <span className="ml-1 text-warn">⚠ limit to be confirmed</span>}
              </p>
            </div>
            <a href={`/registers/${key}/trend/csv?${q}`} className="btn-secondary text-sm">Download CSV (Excel)</a>
          </div>
          {points.some((d) => d.isDemo) && <p className="text-xs font-semibold text-purple-700">Includes DEMO data</p>}

          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><div className="text-xs text-gray-500">Readings</div><b>{points.length}</b></div>
            <div><div className="text-xs text-gray-500">In spec</div><b>{judged ? `${Math.round((inSpec / judged) * 100)}%` : "–"}</b></div>
            {stats && <div><div className="text-xs text-gray-500">Min / Max</div><b>{stats.min} / {stats.max}</b> {p.unit}</div>}
            {stats && <div><div className="text-xs text-gray-500">Average</div><b>{stats.avg.toFixed(2)}</b> {p.unit}</div>}
          </div>

          {p.data_type === "number" ? (
            numeric.length ? (
              <TrendChart
                points={numeric.map((d) => ({
                  t: new Date(d.at).getTime(),
                  v: d.value!,
                  status: d.status,
                  label: `${formatLagos(d.at)} · ${STATUS_LABEL[d.status as Status] ?? d.status}${d.recordedBy ? ` · ${d.recordedBy}` : ""}`,
                }))}
                from={t.from.getTime()}
                to={t.to.getTime()}
                unit={p.unit}
                stdMin={p.std_min}
                stdMax={p.std_max}
                critMin={p.crit_min}
                critMax={p.crit_max}
              />
            ) : (
              <p className="py-8 text-center text-sm text-gray-500">No readings in this period.</p>
            )
          ) : (
            <p className="text-sm text-gray-500">This is a check field ({p.options?.join(" / ")}); see the table below.</p>
          )}

          <details>
            <summary className="cursor-pointer text-sm font-medium">Table of readings ({points.length})</summary>
            <div className="mt-2 max-h-96 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white text-left text-xs text-gray-500">
                  <tr><th className="py-1">Reading for</th><th>Value</th><th>Status</th><th>By</th><th>Comment</th></tr>
                </thead>
                <tbody>
                  {[...points].reverse().map((d, i) => (
                    <tr key={i} className="border-t">
                      <td className="py-1 whitespace-nowrap">{formatLagos(d.at)}</td>
                      <td>{d.value ?? d.text} {p.unit}</td>
                      <td><StatusBadge status={d.status as Status} /></td>
                      <td>{d.recordedBy ?? "–"}</td>
                      <td className="text-xs text-gray-600">{d.comment}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
