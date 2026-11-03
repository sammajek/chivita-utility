"use client";

import { useState } from "react";
import { SECTIONS, SECTION_KEYS, TEMPLATES, type SectionKey } from "@/lib/deck/sections";

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Choose a template or tick sections, set the scope, add commentary per slide, download the .pptx. */
export function DeckForm({ today }: { today: string }) {
  const [template, setTemplate] = useState("weekly");
  const [picked, setPicked] = useState<SectionKey[]>(TEMPLATES.weekly.sections);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);

  function choose(t: string) {
    setTemplate(t);
    if (t !== "custom") setPicked(TEMPLATES[t].sections);
    const days = TEMPLATES[t].days;
    if (days >= 28) {
      const first = `${today.slice(0, 7)}-01`;
      const prevMonthEnd = addDays(first, -1);
      setFrom(`${prevMonthEnd.slice(0, 7)}-01`);
      setTo(prevMonthEnd);
    } else {
      setFrom(addDays(today, -(days - 1)));
      setTo(today);
    }
  }
  const toggle = (k: SectionKey) => {
    setTemplate("custom");
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : SECTION_KEYS.filter((x) => p.includes(x) || x === k)));
  };

  return (
    <form method="post" action="/reports/deck" className="space-y-4" onSubmit={() => { setBusy(true); setTimeout(() => setBusy(false), 8000); }}>
      <section className="card space-y-3">
        <h2 className="font-semibold">1. Template</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(TEMPLATES).map(([k, t]) => (
            <label key={k} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm ${template === k ? "border-brand-blue bg-blue-50" : ""}`}>
              <input type="radio" name="template" value={k} checked={template === k} onChange={() => choose(k)} className="h-5 w-5" /> {t.name}
            </label>
          ))}
        </div>
        <input name="title" className="input" placeholder={`Deck title (default: ${TEMPLATES[template].name})`} />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">2. Scope</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">From<input type="date" name="from" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="input py-2" /></label>
          <label className="text-xs">To<input type="date" name="to" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="input py-2" /></label>
          <label className="text-xs">Area<select name="area" className="input py-2" defaultValue=""><option value="">Utility 1 &amp; 2</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select></label>
        </div>
        <p className="text-xs text-gray-500">Days run 07:00 → 07:00 (log date), as on the registers.</p>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">3. Sections and commentary</h2>
        <p className="text-xs text-gray-500">Each ticked section becomes one slide. Anything you type under it appears in a commentary box on that slide.</p>
        {SECTION_KEYS.map((k) => (
          <div key={k} className="space-y-1">
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" name={`s:${k}`} checked={picked.includes(k)} onChange={() => toggle(k)} className="h-5 w-5" /> {SECTIONS[k]}
            </label>
            {picked.includes(k) && <textarea name={`c:${k}`} rows={2} maxLength={1200} className="input text-sm" placeholder="Commentary for this slide (optional)" />}
          </div>
        ))}
      </section>

      <button className="btn-primary w-full" disabled={busy || !picked.length}>{busy ? "Building the deck… (download starts shortly)" : "Download PowerPoint (.pptx)"}</button>
    </form>
  );
}
