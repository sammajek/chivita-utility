// Writes a sample deck (sample figures, marked DEMO) when SAMPLE_DECK is set; skipped otherwise.
import { writeFileSync } from "node:fs";
import { it } from "vitest";
it.skipIf(!process.env.SAMPLE_DECK)("writes sample deck", async () => {
  const { buildDeck } = await import("./build");
  const mod = await import("./build.test.data");
  writeFileSync(process.env.SAMPLE_DECK!, await buildDeck(mod.data, mod.logo, "03 Nov 2026 10:00"));
});
