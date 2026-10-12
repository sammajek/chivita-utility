import { describe, expect, it } from "vitest";
import { cleanNumberToken, labelStems, matchOcr, numbersIn, rowsFromWords, type OcrField } from "./ocr-match";

const f = (id: string, label: string, unit: string | null, std_min: number | null = null, std_max: number | null = null): OcrField =>
  ({ id, label, unit, std_min, std_max, crit_min: null, crit_max: null });

describe("OCR helpers", () => {
  it("fixes common digit confusions", () => {
    expect(cleanNumberToken("8O.5")).toBe("80.5");
    expect(cleanNumberToken("l2,4")).toBe("12.4");
    expect(numbersIn("STEAM PRESS 8,2 bar")).toEqual(["8.2"]);
    expect(numbersIn("Load 1OO %  Hours 12345")).toEqual(["100", "12345"]);
  });
  it("label stems use HMI abbreviations", () => {
    expect(labelStems("Steam Pressure (bar)")).toEqual(["stea", "pres"]);
    expect(labelStems("Feed Water Temp")).toEqual(["feed", "wate", "temp"]);
  });
});

describe("matching an HMI screen to a boiler register", () => {
  const fields = [
    f("p", "Steam Pressure", "bar", 7, 10),
    f("t", "Feed Water Temperature", "°C", 80, 95),
    f("l", "Feed Water Tank Level", "%", 90, 95),
    f("fs", "Flame Signal", "%", 90, null),
  ];
  const screen = [
    "BOILER 1  RUNNING",
    "STEAM PRESS   8.4 bar",
    "FEED WATER TEMP  86 °C",
    "FW TANK LEVEL  92 %",
    "FLAME SIGNAL",
    "97 %",
    "12:45 10/10/2026",
  ];
  it("fills each field from its own line", () => {
    const r = matchOcr(screen, fields);
    expect(r.suggestions.p.value).toBe("8.4");
    expect(r.suggestions.t.value).toBe("86");
    expect(r.suggestions.l.value).toBe("92");
    expect(r.suggestions.fs.value).toBe("97"); // number on the line under its label
  });
  it("offers the rest as chips (clock, date)", () => {
    const r = matchOcr(screen, fields);
    expect(r.leftovers.map((x) => x.value)).toContain("12");
    expect(Object.keys(r.suggestions)).toHaveLength(4);
  });
  it("does not force a number into an unrelated field", () => {
    const r = matchOcr(["COMPRESSOR LOAD 76 %"], [f("p", "Steam Pressure", "bar")]);
    expect(r.suggestions.p).toBeUndefined();
    expect(r.leftovers).toEqual([{ value: "76", line: "COMPRESSOR LOAD 76 %" }]);
  });
  it("implausible values lose to plausible ones", () => {
    const r = matchOcr(["STEAM PRESS 840", "STEAM PRESS SET 8.5 bar"], [f("p", "Steam Pressure", "bar", 7, 10)]);
    expect(r.suggestions.p.value).toBe("8.5");
  });
});

describe("rebuilding rows from word positions", () => {
  const w = (text: string, x0: number, y0: number, x1 = x0 + 20 * text.length, y1 = y0 + 30) => ({ text, bbox: { x0, y0, x1, y1 } });
  it("joins a label and a far-right value on a tilted photo", () => {
    // labels on the left, values ~600 px to the right and ~12 px higher (photo rotated ~1°)
    const words = [
      w("STEAM", 50, 140), w("PRESS", 180, 138), w("8.4bar", 670, 126),
      w("FEED", 52, 190), w("WATER", 140, 188), w("TEMP", 270, 186), w("86°C", 680, 175),
      w("12:45", 58, 380),
    ];
    expect(rowsFromWords(words)).toEqual(["STEAM PRESS 8.4bar", "FEED WATER TEMP 86°C", "12:45"]);
  });
});
