"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print mt-2 rounded border px-3 py-1 text-sm">
      Print / save PDF
    </button>
  );
}
