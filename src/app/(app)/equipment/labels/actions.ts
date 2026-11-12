"use server";

import { headers } from "next/headers";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";

export interface RoomCodes { error?: string; rooms?: { area: string; svg: string }[] }

/** Issues new control-room codes (old printouts stop working) and returns QR images to print. */
export async function issueRoomCodes(_p: RoomCodes, f: FormData): Promise<RoomCodes> {
  const areas = f.getAll("area").map(String).filter((a) => a === "U1" || a === "U2");
  if (!areas.length) return { error: "Tick at least one control room." };
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const supabase = await createClient();
  const rooms = [];
  for (const area of areas) {
    const { data, error } = await supabase.rpc("issue_checkin_code", { p_area: area });
    if (error) return { error: error.message };
    const url = `${base}/duty?room=${area}&code=${encodeURIComponent(String(data))}`;
    rooms.push({ area, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) });
  }
  return { rooms };
}

export interface ScanLabels { error?: string; labels?: { code: string; name: string; area: string | null; svg: string }[] }

/** New secret scan codes for the machines shown (old labels stop working) and their printable labels. */
export async function issueScanLabels(_p: ScanLabels, f: FormData): Promise<ScanLabels> {
  const ids = f.getAll("asset").map(String).filter(Boolean);
  if (!ids.length) return { error: "No machines selected." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("issue_asset_scan_codes", { p_assets: ids });
  if (error) return { error: error.message };
  const { data: assets } = await supabase.from("assets").select("id, code, name, area").in("id", ids).order("code");
  const codes = new Map(((data ?? []) as { asset_id: string; code: string }[]).map((r) => [r.asset_id, r.code]));
  const h = await headers();
  const base = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
  const labels = await Promise.all(((assets ?? []) as { id: string; code: string; name: string; area: string | null }[])
    .filter((a) => codes.has(a.id))
    .map(async (a) => ({ code: a.code, name: a.name, area: a.area,
      svg: await QRCode.toString(`${base}/equipment/${encodeURIComponent(a.code)}/scan?s=${codes.get(a.id)}`, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) })));
  return { labels };
}
