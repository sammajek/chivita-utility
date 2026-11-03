import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildDeck } from "./build";
import { data, logo } from "./build.test.data";
import { SECTION_KEYS } from "./sections";

describe("buildDeck", () => {
  it("makes a title slide plus one slide per section, each with logo, period and generated time", async () => {
    const buf = await buildDeck(data, logo, "03 Nov 2026 10:00");
    const zip = await JSZip.loadAsync(buf);
    const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
    expect(slides).toHaveLength(1 + SECTION_KEYS.length);
    const master = Object.keys(zip.files).filter((f) => f.startsWith("ppt/slideLayouts/") && f.endsWith(".xml"));
    const layoutXml = (await Promise.all(master.map((f) => zip.file(f)!.async("string")))).join("");
    expect(layoutXml).toContain("Data period: 2026-10-01 to 2026-10-31");
    expect(layoutXml).toContain("Generated 03 Nov 2026 10:00");
    expect(layoutXml).toContain("DEMO");
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/media/"))).toBe(true); // logo embedded
    const all = (await Promise.all(slides.map((f) => zip.file(f)!.async("string")))).join("");
    expect(all).toContain("Compressor 5 bearing failure"); // commentary box
    expect(all).toContain("Source:"); // traceability line
    expect(Object.keys(zip.files).some((f) => f.startsWith("ppt/charts/"))).toBe(true); // native, editable charts
  });
});
