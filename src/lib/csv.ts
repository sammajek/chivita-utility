import { NextResponse } from "next/server";

export const csvEscape = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** A CSV download that opens cleanly in Excel (UTF-8 BOM, CRLF). */
export function csvResponse(name: string, header: string[], rows: unknown[][]) {
  const lines = [header.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))];
  return new NextResponse("﻿" + lines.join("\r\n"), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name.replace(/[^\w.-]+/g, "_")}"` },
  });
}
