// Copies the on-device OCR engine and English model into public/tesseract so the app
// serves them itself (no third-party CDN; works on restricted plant networks).
// Runs automatically after `npm install`.
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "tesseract");
const files = [
  ["node_modules/tesseract.js/dist/worker.min.js", "worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "eng.traineddata.gz"],
];
mkdirSync(out, { recursive: true });
for (const [src, dest] of files) {
  const from = join(root, src);
  if (!existsSync(from)) {
    console.warn(`copy-ocr-assets: missing ${src} (OCR will not work until npm install completes)`);
    continue;
  }
  copyFileSync(from, join(out, dest));
}
console.log("copy-ocr-assets: OCR files ready in public/tesseract");
