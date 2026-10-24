import { createClient } from "@/lib/supabase/server";
import { formatLagos } from "@/lib/time";
import { EvidenceUpload, type EvidenceEntity } from "./EvidenceUpload";

interface Attachment {
  id: string; path: string; file_name: string; mime_type: string | null; caption: string | null; recorded_at: string;
}

/** Evidence attached to one record (photos shown as thumbnails, documents as links), plus the upload button. */
export async function EvidenceList({ entityType, entityId, canAdd }: { entityType: EvidenceEntity; entityId: string; canAdd: boolean }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("attachments")
    .select("id, path, file_name, mime_type, caption, recorded_at")
    .eq("entity_type", entityType).eq("entity_id", entityId).is("voided_at", null)
    .order("recorded_at");
  const files = (data ?? []) as Attachment[];
  const urls = new Map<string, string>();
  if (files.length) {
    const { data: signed } = await supabase.storage.from("evidence").createSignedUrls(files.map((f) => f.path), 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls.set(s.path, s.signedUrl);
  }
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {files.map((f) => {
            const url = urls.get(f.path);
            const img = f.mime_type?.startsWith("image/");
            return (
              <li key={f.id} className="w-28 text-[11px] text-gray-600">
                <a href={url} target="_blank" rel="noreferrer" className="block">
                  {img && url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={url} alt={f.caption ?? f.file_name} className="h-20 w-28 rounded border object-cover" />
                  ) : (
                    <span className="flex h-20 w-28 items-center justify-center rounded border bg-gray-50 px-1 text-center text-brand-blue">
                      📄 {f.file_name}
                    </span>
                  )}
                </a>
                <span className="block truncate" title={f.caption ?? ""}>{f.caption ?? formatLagos(f.recorded_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
      {canAdd && <EvidenceUpload entityType={entityType} entityId={entityId} />}
    </div>
  );
}
