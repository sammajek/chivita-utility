"use client";

/** Print the page (or "Save as PDF" in the print dialog). Hidden on the printout itself. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="no-print btn-secondary btn-sm mt-3">
      Print / save PDF
    </button>
  );
}
