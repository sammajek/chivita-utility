/**
 * Parses a logger CSV export into import rows. Header row required; columns (any order, case-insensitive):
 *   timestamp, value, and either asset_code + parameter, or meter_code.
 * Comma, semicolon or tab separated. Timestamps without a zone are taken as Lagos time (+01:00).
 */
export interface LoggerRow { timestamp: string; value: string; asset_code?: string; parameter?: string; meter_code?: string }

export function parseLoggerCsv(text: string): { rows: LoggerRow[]; errors: string[] } {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { rows: [], errors: ["The file needs a header row and at least one data row."] };
  const sep = [";", "\t", ","].find((s) => lines[0].includes(s)) ?? ",";
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, "_"));
  const col = (n: string) => head.indexOf(n);
  const errors: string[] = [];
  if (col("timestamp") < 0 || col("value") < 0) errors.push("Columns timestamp and value are required.");
  if (col("meter_code") < 0 && (col("asset_code") < 0 || col("parameter") < 0)) errors.push("Add meter_code, or asset_code and parameter.");
  if (errors.length) return { rows: [], errors };
  const rows: LoggerRow[] = [];
  lines.slice(1).forEach((line, n) => {
    const c = line.split(sep).map((v) => v.trim().replace(/^"(.*)"$/, "$1"));
    const g = (k: string) => (col(k) >= 0 ? c[col(k)] ?? "" : "");
    let ts = g("timestamp").replace(" ", "T");
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(ts)) ts += "+01:00"; // Lagos local time
    if (Number.isNaN(Date.parse(ts))) { errors.push(`Row ${n + 2}: timestamp "${g("timestamp")}" not understood (use 2026-11-03 07:00).`); return; }
    const row: LoggerRow = { timestamp: ts, value: g("value") };
    if (g("meter_code")) row.meter_code = g("meter_code");
    else { row.asset_code = g("asset_code"); row.parameter = g("parameter"); }
    rows.push(row);
  });
  return { rows, errors };
}
