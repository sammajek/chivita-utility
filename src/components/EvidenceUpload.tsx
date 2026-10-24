"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type EvidenceEntity =
  | "downtime" | "followup" | "pm_completion" | "pm_affirmation" | "cleaning" | "rca" | "asset"
  | "water_result" | "calibration" | "job_request" | "external_report" | "training";

const ACCEPT = "image/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx";
const MAX_BYTES = 10 * 1024 * 1024;

/** Shrinks a phone photo to at most 1600 px on the long side (JPEG) so it uploads quickly on site. */
async function shrinkImage(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Could not read the photo."))), "image/jpeg", 0.82));
}

/** Take a photo or attach a document as evidence for a record. Files go to the private "evidence" bucket. */
export function EvidenceUpload({ entityType, entityId, label = "Add photo / document" }: {
  entityType: EvidenceEntity; entityId: string; label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [caption, setCaption] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const router = useRouter();

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg({});
    try {
      const isImage = file.type.startsWith("image/");
      const body: Blob = isImage ? await shrinkImage(file) : file;
      if (body.size > MAX_BYTES) throw new Error("The file is larger than 10 MB.");
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in again.");
      const name = isImage ? file.name.replace(/\.[^.]+$/, "") + ".jpg" : file.name;
      const safe = name.replace(/[^\w.-]+/g, "_").slice(-80);
      const path = `${user.id}/${entityType}/${entityId}/${Date.now()}-${safe}`;
      const type = isImage ? "image/jpeg" : file.type || "application/octet-stream";
      const { error: upErr } = await supabase.storage.from("evidence").upload(path, body, { contentType: type });
      if (upErr) throw new Error(upErr.message);
      const { error } = await supabase.from("attachments").insert({
        entity_type: entityType, entity_id: entityId, path, file_name: name, mime_type: type,
        size_bytes: body.size, caption: caption.trim() || null, recorded_by_type: "person",
      } as never);
      if (error) throw new Error(error.message);
      setCaption("");
      setMsg({ ok: "Attached." });
      router.refresh();
    } catch (e) {
      setMsg({ error: e instanceof Error ? e.message : "Upload failed." });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Caption (optional)" className="input max-w-xs py-2" />
      <button type="button" className="rounded-lg border border-brand-blue px-3 py-2 text-sm font-semibold text-brand-blue disabled:opacity-50"
        disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Uploading…" : `📎 ${label}`}
      </button>
      <input ref={input} type="file" accept={ACCEPT} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
      {msg.ok && <span className="text-xs text-ok">{msg.ok}</span>}
      {msg.error && <span className="text-xs text-crit">{msg.error}</span>}
    </div>
  );
}
