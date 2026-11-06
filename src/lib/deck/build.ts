import PptxGenJS from "pptxgenjs";
import { FREQ_LABEL, type PmFrequency } from "@/lib/pm";
import { H, THEME, W, defineMaster } from "./theme";
import { SECTIONS, TEMPLATES, type SectionKey } from "./sections";
import type { DeckData } from "./data";

type Slide = PptxGenJS.Slide;
const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 1000) / 10}%` : "–");
const num = (n: number | null | undefined, dp = 0) => (n === null || n === undefined || Number.isNaN(n) ? "–" : n.toLocaleString("en-GB", { maximumFractionDigits: dp }));
const AREA = { "": "Utility 1 & 2", U1: "Utility 1", U2: "Utility 2" } as const;

/** Builds the .pptx. `logoData` = "image/png;base64,…"; `generatedAt` = Lagos time text. */
export async function buildDeck(d: DeckData, logoData: string, generatedAt: string): Promise<Buffer> {
  const s = d.scope;
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.company = "CHI Limited – Utility section, Engineering";
  pptx.title = s.title;
  const period = `${s.from} to ${s.to} · ${AREA[s.area]}`;
  defineMaster(pptx, logoData, `CHI Utility Ops · Data period: ${period} · Generated ${generatedAt}${d.hasDemo ? " · contains DEMO data" : ""}`);

  // Title slide
  const t = pptx.addSlide({ masterName: THEME.master });
  t.addText(s.title, { x: 0.8, y: 2.3, w: W - 1.6, h: 1.1, fontFace: THEME.font, fontSize: 36, bold: true, color: THEME.blue });
  t.addText(`${TEMPLATES[s.template]?.name ?? "Report"} · ${period}`, { x: 0.8, y: 3.4, w: W - 1.6, h: 0.5, fontFace: THEME.font, fontSize: 18, color: THEME.dark });
  t.addText("Utility section, Engineering Department · CHI Limited (Chivita | Hollandia)", { x: 0.8, y: 4.0, w: W - 1.6, h: 0.4, fontFace: THEME.font, fontSize: 14, color: THEME.grey });
  if (d.hasDemo) t.addText("Contains DEMO data — not for decisions", { x: 0.8, y: 4.6, w: 6, h: 0.4, fontFace: THEME.font, fontSize: 14, bold: true, color: THEME.crit });

  const slide = (key: SectionKey, title: string, source: string) => {
    const sl = pptx.addSlide({ masterName: THEME.master });
    sl.addText(title, { x: 0.4, y: 0.2, w: W - 2.6, h: 0.6, fontFace: THEME.font, fontSize: 24, bold: true, color: THEME.blue });
    sl.addText(period, { x: 0.4, y: 0.75, w: W - 2.6, h: 0.3, fontFace: THEME.font, fontSize: 11, color: THEME.grey });
    sl.addText(`Source: ${source}`, { x: 0.4, y: H - 0.8, w: W - 0.8, h: 0.28, fontFace: THEME.font, fontSize: 8, italic: true, color: THEME.grey });
    const note = s.commentary[key]?.trim();
    if (note) {
      sl.addText([{ text: "Commentary  ", options: { bold: true, color: THEME.red } }, { text: note }], {
        x: 0.4, y: H - 1.75, w: W - 0.8, h: 0.9, fontFace: THEME.font, fontSize: 12, color: THEME.dark, fill: { color: THEME.light }, valign: "top", margin: 6,
      });
    }
    return { sl, bodyH: note ? H - 3.05 : H - 2.1 };
  };
  const tiles = (sl: Slide, items: [string, string, string?][], y = 1.25) => {
    const w = (W - 0.8 - 0.2 * (items.length - 1)) / items.length;
    items.forEach(([label, value, tone], i) => {
      const x = 0.4 + i * (w + 0.2);
      sl.addShape(pptx.ShapeType.rect, { x, y, w, h: 1.2, fill: { color: THEME.light }, line: { color: "E5E7EB" } });
      sl.addText(value, { x, y: y + 0.1, w, h: 0.65, align: "center", fontFace: THEME.font, fontSize: 26, bold: true, color: tone ?? THEME.dark });
      sl.addText(label, { x, y: y + 0.75, w, h: 0.4, align: "center", fontFace: THEME.font, fontSize: 11, color: THEME.grey });
    });
  };
  const table = (sl: Slide, head: string[], rows: (string | number)[][], y: number, h: number, colW?: number[]) => {
    if (!rows.length) {
      sl.addText("No records in this period.", { x: 0.4, y, w: W - 0.8, h: 0.4, fontFace: THEME.font, fontSize: 12, color: THEME.grey });
      return;
    }
    const maxRows = Math.max(1, Math.floor(h / 0.32) - 1);
    const body = rows.slice(0, maxRows).map((r) => r.map((c) => ({ text: String(c), options: { fontSize: 10 } })));
    sl.addTable([head.map((c) => ({ text: c, options: { bold: true, color: "FFFFFF", fill: { color: THEME.blue }, fontSize: 10 } })), ...body], {
      x: 0.4, y, w: W - 0.8, colW, fontFace: THEME.font, border: { type: "solid", color: "D1D5DB", pt: 0.5 }, rowH: 0.3,
    });
    if (rows.length > maxRows) sl.addText(`…and ${rows.length - maxRows} more (see the app)`, { x: 0.4, y: y + h, w: 6, h: 0.3, fontFace: THEME.font, fontSize: 9, color: THEME.grey });
  };
  /** Horizontal bars, biggest on top, axis from zero, one colour per series (identity by series, not by row). */
  const bar = (sl: Slide, labels: string[], series: { name: string; values: number[] }[], x: number, y: number, w: number, h: number, opts: Record<string, unknown> = {}) => {
    if (!labels.length) return;
    const rev = <T,>(a: T[]) => [...a].reverse(); // PowerPoint draws the first category at the bottom
    sl.addChart(pptx.ChartType.bar, series.map((se) => ({ name: se.name, labels: rev(labels), values: rev(se.values) })), {
      x, y, w, h, barDir: "bar", chartColors: [THEME.blue, THEME.red, THEME.grey].slice(0, Math.max(1, series.length)),
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, valAxisMinVal: 0, valGridLine: { color: "E5E7EB", size: 0.5 },
      showLegend: series.length > 1, legendPos: "b", legendFontSize: 9, dataLabelFontSize: 9, showValue: true, ...opts,
    });
  };

  for (const key of s.sections) {
    if (key === "summary" && d.dash) {
      const { sl } = slide(key, SECTIONS.summary, "downtime log, flags, equipment registers (today's slots)");
      const f = d.dash.fleet;
      tiles(sl, [
        ["Availability (unplanned)", f.availability === null ? "–" : `${Math.round(f.availability * 1000) / 10}%`, (f.availability ?? 1) < 0.95 ? THEME.warn : THEME.ok],
        ["Breakdowns", num(f.events)], ["Breakdown hours", num(f.unplannedHours, 1)], ["MTTR (h)", num(f.mttr, 1)],
      ]);
      tiles(sl, [
        ["Open flags", num(d.dash.openFlags), d.dash.criticalFlags ? THEME.crit : THEME.dark], ["Critical flags", num(d.dash.criticalFlags), d.dash.criticalFlags ? THEME.crit : THEME.dark],
        ["Open downtime events", num(d.dash.openDowntime)], ["Today's reading compliance", d.dash.compliance.pct === null ? "–" : `${Math.round(d.dash.compliance.pct)}%`],
      ], 2.65);
      const worst = d.dash.kpis.slice(0, 6).map((k) => [k.code, k.name, num(k.unplanned_hours, 1), num(k.failures), k.mttr === null ? "–" : num(k.mttr, 1), k.mtbf === null ? "–" : num(k.mtbf, 0), k.availability === null ? "–" : `${Math.round(k.availability * 1000) / 10}%`]);
      table(sl, ["Code", "Equipment (most breakdown hours)", "Hours", "Failures", "MTTR h", "MTBF h", "Availability"], worst, 4.05, 1.6, [1.2, 4.8, 1.1, 1.1, 1.1, 1.1, 1.73]);
    }
    if (key === "downtime" && d.dash) {
      const { sl, bodyH } = slide(key, SECTIONS.downtime, "downtime log (603-001 fields); unplanned breakdowns only in the Pareto");
      const p = d.dash.pareto;
      bar(sl, p.map((x) => x.label), [{ name: "Hours", values: p.map((x) => Math.round(x.hours * 10) / 10) }], 0.4, 1.15, 6.1, bodyH - 0.1, { valAxisTitle: "hours", showValAxisTitle: true });
      sl.addText("Main events", { x: 6.8, y: 1.15, w: 6, h: 0.3, fontFace: THEME.font, fontSize: 12, bold: true, color: THEME.dark });
      const ev = (d.topEvents ?? []).map((e) => [e.event_no, `${e.code} ${e.name}`, e.mode, num(e.hours, 1), e.status]);
      sl.addTable([["Event", "Equipment", "Failure mode", "h", "Status"].map((c) => ({ text: c, options: { bold: true, color: "FFFFFF", fill: { color: THEME.blue }, fontSize: 9 } })),
        ...ev.map((r) => r.map((c) => ({ text: String(c), options: { fontSize: 9 } })))], { x: 6.8, y: 1.5, w: 6.1, colW: [0.8, 2.0, 2.0, 0.5, 0.8], fontFace: THEME.font, border: { type: "solid", color: "D1D5DB", pt: 0.5 } });
    }
    if (key === "rca" && d.rcas) {
      const { sl, bodyH } = slide(key, SECTIONS.rca, "RCA register (5-Whys / 6M)");
      table(sl, ["RCA", "Equipment", "Problem", "Status", "Target date"],
        d.rcas.map((r) => [r.rca_no, r.code, r.problem.slice(0, 90), r.status, `${r.target_date ?? "—"}${r.overdue ? " (overdue)" : ""}`]), 1.2, bodyH, [1, 1.2, 6.33, 2.2, 1.8]);
    }
    if (key === "readings" && d.readings) {
      const { sl, bodyH } = slide(key, SECTIONS.readings, "equipment registers: readings judged against the standards; missing = slots flagged 60 min after due");
      const r = d.readings.filter((x) => x.ok + x.oos + x.crit + x.missing > 0);
      const all = r.reduce((a, x) => ({ ok: a.ok + x.ok, oos: a.oos + x.oos, crit: a.crit + x.crit, miss: a.miss + x.missing }), { ok: 0, oos: 0, crit: 0, miss: 0 });
      tiles(sl, [["Readings in spec", pct(all.ok, all.ok + all.oos + all.crit), THEME.ok], ["Out of spec", num(all.oos), all.oos ? THEME.warn : THEME.dark],
        ["Critical", num(all.crit), all.crit ? THEME.crit : THEME.dark], ["Missing slots flagged", num(all.miss), all.miss ? THEME.warn : THEME.dark]]);
      table(sl, ["Area", "Register", "Doc no", "In spec", "Out of spec", "Critical", "Missing", "> 1 h late"],
        r.map((x) => [x.area, x.title, x.document_no, pct(x.ok, x.ok + x.oos + x.crit), x.oos, x.crit, x.missing, x.late]), 2.65, bodyH - 1.5, [0.7, 4.5, 1.6, 1.0, 1.1, 0.9, 1.0, 1.73]);
    }
    if (key === "pm" && d.pm) {
      const { sl, bodyH } = slide(key, SECTIONS.pm, "PM log CHIENGUTRG08: periods ending in the data period; carried out = √ or X");
      const due = d.pm.reduce((a, x) => a + x.due, 0), done = d.pm.reduce((a, x) => a + x.ok + x.nok, 0);
      tiles(sl, [["PM adherence", pct(done, due), due && done / due < 0.85 ? THEME.warn : THEME.ok], ["PMs due", num(due)], ["Done OK (√)", num(d.pm.reduce((a, x) => a + x.ok, 0))],
        ["Done, not OK (X)", num(d.pm.reduce((a, x) => a + x.nok, 0))], ["Not done / blank", num(due - done)]]);
      bar(sl, d.pm.map((x) => FREQ_LABEL[x.frequency as PmFrequency] ?? x.frequency),
        [{ name: "Adherence %", values: d.pm.map((x) => (x.due ? Math.round(((x.ok + x.nok) / x.due) * 1000) / 10 : 0)) }], 0.4, 2.65, W - 0.8, bodyH - 1.5, { valAxisMaxVal: 100 });
    }
    if (key === "amc" && d.amc) {
      const { sl, bodyH } = slide(key, SECTIONS.amc, "AMC tracker: planned vs done visits per month");
      const planned = d.amc.reduce((a, x) => a + x.planned, 0), done = d.amc.reduce((a, x) => a + x.done, 0);
      tiles(sl, [["AMC compliance", pct(done, planned), planned && done / planned < 0.85 ? THEME.warn : THEME.ok], ["Visits planned", num(planned)], ["Visits done", num(done)]]);
      table(sl, ["Contract", "Vendor", "Planned", "Done", "Compliance"], d.amc.map((x) => [x.contract, x.vendor, x.planned, x.done, pct(x.done, x.planned)]), 2.65, bodyH - 1.5, [5.2, 3.2, 1.2, 1.2, 1.73]);
    }
    if (key === "consumption" && d.consumption) {
      const { sl, bodyH } = slide(key, SECTIONS.consumption, "7A.M daily utility consumption report: use = difference between 07:00 readings");
      const c = d.consumption;
      const sum = (pred: (x: (typeof c)[number]) => boolean) => c.filter(pred).reduce((a, x) => a + x.total, 0);
      const gas = sum((x) => x.kind === "totaliser" && x.unit === "m³" && /gas/i.test(x.name));
      const kwh = sum((x) => x.unit === "kWh" && x.group === "energy"); // the 7 A.M. sheet repeats some compressor meters
      const wtp = sum((x) => x.name === "WTP output");
      const bh = sum((x) => x.group === "borehole");
      tiles(sl, [["Gas (boilers + VAM), m³", num(gas)], ["Electricity, kWh", num(kwh)], ["WTP output, m³", num(wtp)], ["Borehole abstraction, m³", num(bh)]]);
      const energy = c.filter((x) => x.unit === "kWh" && x.group === "energy").sort((a, b) => b.total - a.total).slice(0, 10);
      bar(sl, energy.map((x) => x.name), [{ name: "kWh", values: energy.map((x) => Math.round(x.total)) }], 0.4, 2.65, 6.1, bodyH - 1.5);
      const water = c.filter((x) => x.group === "water" && x.name.startsWith("Line")).sort((a, b) => b.total - a.total).slice(0, 10);
      bar(sl, water.map((x) => x.name.replace(/^Line \d+ – /, "")), [{ name: "m³", values: water.map((x) => Math.round(x.total)) }], 6.8, 2.65, 6.1, bodyH - 1.5);
    }
    if (key === "water" && d.water) {
      const { sl } = slide(key, SECTIONS.water, "process water sampling plan CHICQARG24; instrument calibration register");
      const w = d.water;
      tiles(sl, [["Water results in spec", pct(w.ok, w.ok + w.alert + w.action), THEME.ok], ["Alert", num(w.alert), w.alert ? THEME.warn : THEME.dark], ["Action (out of spec)", num(w.action), w.action ? THEME.crit : THEME.dark]]);
      tiles(sl, [["Instruments", num(w.instruments)], ["Calibration overdue", num(w.overdueCal), w.overdueCal ? THEME.crit : THEME.dark], ["Due in 30 days", num(w.dueSoonCal), w.dueSoonCal ? THEME.warn : THEME.dark]], 2.65);
    }
    if (key === "engineers" && d.engineers && d.kpiDefs) {
      const { sl, bodyH } = slide(key, SECTIONS.engineers, "Individual Engineer KPI Tracker: auto KPIs from the app on each engineer's shifts; safety/THERMAX from the weekly log");
      const defs = d.kpiDefs;
      table(sl, ["Engineer", ...defs.map((k) => k.name.replace(/ %.*$/, "").replace("Compliance", "").trim())],
        d.engineers.map((e) => [e.name, ...defs.map((k) => (e.values[k.code] === null ? "—" : `${e.values[k.code]}%${(e.values[k.code] as number) >= k.target_min ? "" : " ✗"}`))]),
        1.2, bodyH, [2.0, ...defs.map(() => (W - 0.8 - 2.0) / defs.length)]);
    }
    if (key === "training" && d.training) {
      const { sl, bodyH } = slide(key, SECTIONS.training, "Training Needs for Utility Section (training register)");
      const tr = d.training;
      tiles(sl, [["Trainings planned", num(tr.planned)], ["Completed", num(tr.completed), THEME.ok], ["Completion", pct(tr.completed, tr.planned)], ["Past date, not confirmed", num(tr.pastDue), tr.pastDue ? THEME.warn : THEME.dark]]);
      table(sl, ["Course", "Participants", "Done"], tr.byCourse.map((c) => [c.course, c.planned, c.done]), 2.65, bodyH - 1.5, [9.33, 1.6, 1.6]);
    }
  }

  return (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
}
