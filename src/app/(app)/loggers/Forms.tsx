"use client";

import { useActionState } from "react";
import { issueKey, uploadCsv, type KeyState, type UploadState } from "./actions";

export function KeyForm() {
  const [s, action, pending] = useActionState<KeyState, FormData>(issueKey, {});
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <input name="name" required minLength={3} className="input" placeholder="Logger name (e.g. U1 energy meter gateway)" />
        <input name="description" className="input" placeholder="What it measures / where" />
        <select name="area" className="input" defaultValue=""><option value="">Area: both</option><option value="U1">Utility 1</option><option value="U2">Utility 2</option></select>
      </div>
      <button className="btn-secondary" disabled={pending}>{pending ? "…" : "Create logger / issue new key"}</button>
      {s.error && <p className="text-sm text-crit">{s.error}</p>}
      {s.key && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          <p className="text-warn">{s.ok}</p>
          <code className="mt-1 block select-all break-all rounded bg-white p-2 font-mono text-xs">{s.key}</code>
        </div>
      )}
    </form>
  );
}

export function UploadForm({ loggers }: { loggers: { id: string; name: string }[] }) {
  const [s, action, pending] = useActionState<UploadState, FormData>(uploadCsv, {});
  return (
    <form action={action} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <select name="logger_id" required className="input" defaultValue=""><option value="" disabled>The logger the data came from…</option>{loggers.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <input type="file" name="file" accept=".csv,text/csv,text/plain" className="input py-2" />
      </div>
      <textarea name="csv" rows={4} className="input font-mono text-xs" placeholder={"…or paste:\ntimestamp,asset_code,parameter,meter_code,value\n2026-11-03 09:00,CMP-03,Running Hours,,4321\n2026-11-03 07:00,,,E-C3,120000"} />
      <button className="btn-secondary" disabled={pending}>{pending ? "Importing…" : "Import"}</button>
      {s.error && <p className="text-sm text-crit">{s.error}</p>}
      {s.ok && <p className="text-sm text-ok">{s.ok}</p>}
      {s.errors && s.errors.length > 0 && <ul className="list-disc pl-5 text-xs text-gray-600">{s.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </form>
  );
}
