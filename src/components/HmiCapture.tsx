"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { enhanceForOcr } from "@/lib/ocr-image";
import { matchOcr, rowsFromWords, type MatchResult, type OcrField, type OcrWord } from "@/lib/ocr-match";

export interface CaptureResult extends MatchResult {
  photoPath: string | null;
  previewUrl: string;
  text: string;
}

/** Shrinks the photo, converts it to high-contrast greyscale for OCR, and returns both versions. */
async function prepare(file: File): Promise<{ ocr: HTMLCanvasElement; jpeg: Blob }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const photo = document.createElement("canvas");
  photo.width = w;
  photo.height = h;
  photo.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
  const jpeg = await new Promise<Blob>((res) => photo.toBlob((b) => res(b!), "image/jpeg", 0.75));

  const ocr = document.createElement("canvas");
  ocr.width = w;
  ocr.height = h;
  const ctx = ocr.getContext("2d")!;
  ctx.drawImage(photo, 0, 0);
  const img = ctx.getImageData(0, 0, w, h);
  enhanceForOcr(img.data);
  ctx.putImageData(img, 0, 0);
  return { ocr, jpeg };
}

/**
 * "Snap HMI" button. Text recognition runs on the phone (Tesseract.js); the photo itself is only
 * uploaded to the company's own Supabase storage, as evidence for the readings.
 */
export function HmiCapture({ fields, folder, onResult }: {
  fields: OcrField[];
  folder: string; // e.g. "<userId>/<register>/<date>"
  onResult: (r: CaptureResult) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(file: File) {
    setError(null);
    try {
      setBusy("Preparing photo…");
      const { ocr, jpeg } = await prepare(file);
      const previewUrl = URL.createObjectURL(jpeg);

      setBusy("Uploading photo…");
      let photoPath: string | null = null;
      try {
        const supabase = createClient();
        const path = `${folder}/${Date.now()}.jpg`;
        const { error: upErr } = await supabase.storage.from("hmi-photos").upload(path, jpeg, { contentType: "image/jpeg" });
        if (!upErr) photoPath = path;
      } catch {
        // keep going without the photo; the values can still be read and checked
      }

      setBusy("Reading the screen…");
      // engine and English model are served by this app (public/tesseract), nothing is fetched from elsewhere
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract",
        langPath: "/tesseract",
        gzip: true,
      });
      await worker.setParameters({ tessedit_pageseg_mode: "11" as never }); // sparse text: HMI labels and values
      const { data } = await worker.recognize(ocr, {}, { blocks: true });
      await worker.terminate();
      const text = data.text ?? "";
      type Block = { paragraphs: { lines: { words: OcrWord[] }[] }[] };
      const words = ((data.blocks ?? []) as unknown as Block[]).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
      // label and value usually sit far apart on an HMI; rows rebuilt from positions keep them together
      const byRows = matchOcr(rowsFromWords(words), fields);
      const byLines = matchOcr(text.split(/\r?\n/), fields);
      const best = Object.keys(byLines.suggestions).length > Object.keys(byRows.suggestions).length ? byLines : byRows;
      onResult({ ...best, photoPath, previewUrl, text: rowsFromWords(words).join("\n") || text });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the photo. Enter the values by hand.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => e.target.files?.[0] && handle(e.target.files[0])} />
      <button type="button" disabled={!!busy} onClick={() => input.current?.click()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-brand-blue bg-blue-50 px-4 py-3 text-sm font-semibold text-brand-blue disabled:opacity-60">
        <span aria-hidden>📷</span> {busy ?? "Snap the HMI screen to fill values"}
      </button>
      {error && <p className="mt-1 text-xs text-crit">{error}</p>}
    </div>
  );
}
