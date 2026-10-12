/**
 * Matches text read from an equipment HMI photo to the fields of a register form.
 *
 * The OCR gives lines of text such as "STEAM PRESS 8.2 bar" or "Feed Water Temp  86 °C".
 * For each line we take the numbers, then score every field by how many words of its label
 * (or common HMI abbreviations of them) appear on the line, whether the unit matches, and
 * whether the number is plausible for that parameter. Fields are filled greedily, best score
 * first; anything left over is offered to the operator as a tap-to-fill chip.
 * The operator always checks the values before saving.
 */

export interface OcrField {
  id: string;
  label: string;
  unit: string | null;
  std_min: number | null;
  std_max: number | null;
  crit_min: number | null;
  crit_max: number | null;
}

export interface Suggestion {
  value: string;
  score: number;
  line: string;
}

export interface MatchResult {
  suggestions: Record<string, Suggestion>;
  /** Numbers that could not be tied to a field, in the order they appear. */
  leftovers: { value: string; line: string }[];
}

const STOP = new Set(["of", "the", "and", "no", "nr", "to", "in", "at", "for", "with", "unit", "value"]);

// HMI abbreviations → the word stem used in register labels
const SYNONYMS: Record<string, string> = {
  temp: "temp", tmp: "temp", t: "temp", press: "pres", pr: "pres", prs: "pres", p: "pres",
  lvl: "leve", lev: "leve", cond: "cond", ec: "cond", flw: "flow", fl: "flow", curr: "curr", amp: "curr", amps: "curr",
  i: "curr", hrs: "hour", hr: "hour", run: "runn", spd: "spee", freq: "freq", hz: "freq", volt: "volt", v: "volt",
  disch: "disc", dis: "disc", suct: "suct", suc: "suct", evap: "evap", cnd: "cond", ret: "retu", sup: "supp",
  supply: "supp", lwt: "leav", ewt: "ente", dp: "dewp", dew: "dewp", diff: "diff", fw: "feed", stm: "stea",
};

const UNIT_ALIASES: Record<string, string[]> = {
  bar: ["bar", "barg"], "°c": ["°c", "c", "degc", "deg"], "%": ["%"], kpa: ["kpa"], "m³/h": ["m3/h", "m³/h", "m3h"],
  a: ["a", "amp", "amps"], hz: ["hz"], kw: ["kw"], ppm: ["ppm"], "µs/cm": ["us/cm", "µs/cm", "μs/cm"], psi: ["psi"],
  h: ["h", "hrs", "hr"], tr: ["tr"], mbar: ["mbar"], mmhg: ["mmhg"],
};

function stem(w: string): string {
  const s = w.toLowerCase().replace(/[^a-z0-9]/g, "");
  return SYNONYMS[s] ?? s.slice(0, 4);
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[()[\],:;=|_/\\-]+/g, " ")
    .split(/\s+/)
    .filter((w) => /[a-z]/.test(w) && !/^[-+]?\d/.test(w));
}

export function labelStems(label: string): string[] {
  const out = new Set<string>();
  for (const w of words(label.replace(/\(.*?\)/g, " "))) {
    if (STOP.has(w) || w.length < 2) continue;
    out.add(stem(w));
  }
  return [...out];
}

/** Fix common OCR confusions inside numbers (O→0, l/I→1, S→5, comma decimal). */
export function cleanNumberToken(tok: string): string {
  if (!/\d/.test(tok)) return tok;
  return tok.replace(/[Oo]/g, "0").replace(/[lI|]/g, "1").replace(/S/g, "5").replace(/,(\d)/g, ".$1");
}

export function numbersIn(line: string): string[] {
  const cleaned = line.split(/\s+/).map(cleanNumberToken).join(" ");
  return [...cleaned.matchAll(/(?<![\d.])-?\d+(?:\.\d+)?(?![\d.])/g)].map((m) => m[0]);
}

function unitBonus(field: OcrField, line: string): number {
  if (!field.unit) return 0;
  const l = line.toLowerCase().replace(/\s+/g, "");
  const aliases = UNIT_ALIASES[field.unit.toLowerCase()] ?? [field.unit.toLowerCase()];
  return aliases.some((a) => a.length > 1 && l.includes(a.replace(/\s+/g, ""))) ? 0.3 : 0;
}

function plausibility(field: OcrField, v: number): number {
  const lo = field.crit_min ?? field.std_min;
  const hi = field.crit_max ?? field.std_max;
  if (lo === null && hi === null) return 0;
  const span = Math.max(Math.abs(hi ?? lo ?? 1), Math.abs(lo ?? hi ?? 1), 1);
  const min = (lo ?? -Infinity) - span;
  const max = (hi ?? Infinity) + span;
  if (v >= (lo ?? -Infinity) && v <= (hi ?? Infinity)) return 0.25;
  return v >= min && v <= max ? 0 : -0.6;
}

export function matchOcr(lines: string[], fields: OcrField[]): MatchResult {
  const candidates: { fieldId: string; value: string; score: number; line: string; key: string }[] = [];
  const all: { value: string; line: string; key: string }[] = [];
  const stemsByField = new Map(fields.map((f) => [f.id, labelStems(f.label)]));

  lines.forEach((raw, li) => {
    const line = raw.trim();
    if (!line) return;
    const nums = numbersIn(line);
    if (!nums.length) return;
    // a number on a line by itself usually belongs to the label on the line above
    const ctx = words(line).length === 0 && li > 0 ? `${lines[li - 1]} ${line}` : line;
    const lineStems = new Set(words(ctx).map(stem));
    nums.forEach((value, ni) => {
      const key = `${li}:${ni}`;
      all.push({ value, line, key });
      for (const f of fields) {
        const fs = stemsByField.get(f.id) ?? [];
        if (!fs.length) continue;
        const hits = fs.filter((s) => lineStems.has(s)).length;
        if (!hits) continue;
        const score = hits / fs.length + unitBonus(f, ctx) + plausibility(f, Number(value)) - ni * 0.05;
        candidates.push({ fieldId: f.id, value, score, line, key });
      }
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  const suggestions: Record<string, Suggestion> = {};
  const used = new Set<string>();
  for (const c of candidates) {
    if (c.score < 0.5 || suggestions[c.fieldId] || used.has(c.key)) continue;
    suggestions[c.fieldId] = { value: c.value, score: Math.round(c.score * 100) / 100, line: c.line };
    used.add(c.key);
  }
  // single-field form with one bare number on screen (no other words, or the right unit): take it
  if (fields.length === 1 && !suggestions[fields[0].id] && all.length === 1
      && (words(all[0].line).length === 0 || unitBonus(fields[0], all[0].line) > 0)) {
    suggestions[fields[0].id] = { value: all[0].value, score: 0.5, line: all[0].line };
    used.add(all[0].key);
  }
  return { suggestions, leftovers: all.filter((n) => !used.has(n.key)).map(({ value, line }) => ({ value, line })) };
}

export interface OcrWord {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * Rebuilds screen rows from word positions, so a label on the left and its value on the right
 * end up on the same line even when the OCR read them as separate blocks. Tolerates a slightly
 * tilted photo by following each row's slope.
 */
export function rowsFromWords(words: OcrWord[]): string[] {
  const ws = words.filter((w) => w.text.trim()).map((w) => ({
    text: w.text.trim(),
    cx: (w.bbox.x0 + w.bbox.x1) / 2,
    cy: (w.bbox.y0 + w.bbox.y1) / 2,
    h: Math.max(1, w.bbox.y1 - w.bbox.y0),
    x0: w.bbox.x0,
  }));
  if (!ws.length) return [];
  const heights = ws.map((w) => w.h).sort((a, b) => a - b);
  const medH = heights[Math.floor(heights.length / 2)];
  ws.sort((a, b) => a.x0 - b.x0);
  const rows: { words: typeof ws; slope: number }[] = [];
  for (const w of ws) {
    let best: (typeof rows)[number] | null = null;
    let bestD = Infinity;
    for (const r of rows) {
      const last = r.words[r.words.length - 1];
      const expected = last.cy + r.slope * (w.cx - last.cx);
      const d = Math.abs(w.cy - expected);
      if (d < bestD) { bestD = d; best = r; }
    }
    if (best && bestD < medH * 0.6) {
      const first = best.words[0];
      best.words.push(w);
      if (w.cx - first.cx > medH * 3) best.slope = Math.max(-0.15, Math.min(0.15, (w.cy - first.cy) / (w.cx - first.cx)));
    } else {
      rows.push({ words: [w], slope: 0 });
    }
  }
  return rows
    .sort((a, b) => a.words[0].cy - b.words[0].cy)
    .map((r) => r.words.sort((a, b) => a.x0 - b.x0).map((w) => w.text).join(" "));
}
