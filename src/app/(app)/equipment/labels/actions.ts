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
