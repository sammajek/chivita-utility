import { requireProfile } from "@/lib/auth";
import { lagosDate } from "@/lib/time";
import { DeckForm } from "./DeckForm";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const profile = await requireProfile();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Reports &amp; presentations</h1>
        <p className="text-sm text-gray-600">Build a PowerPoint deck from live data: logo, data period and “generated at” on every slide, editable charts, a source line on each slide, and your commentary.</p>
      </div>
      {profile.active ? <DeckForm today={lagosDate(new Date())} /> : <p className="card text-sm text-gray-600">Your account is not active yet.</p>}
      <p className="text-xs text-gray-500">Layout is a clean placeholder in Chivita colours; it switches to the corporate PowerPoint template once that is supplied. Printable reports are also on each page (PM report, consumption report, handover, training, KPIs).</p>
    </div>
  );
}
