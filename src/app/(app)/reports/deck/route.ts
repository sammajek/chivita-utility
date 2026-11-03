import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildDeck } from "@/lib/deck/build";
import { loadDeckData } from "@/lib/deck/data";
import { periodDates, PERIODS, type Period } from "@/lib/deck/period";
import { SECTION_KEYS, TEMPLATES, type DeckScope, type SectionKey } from "@/lib/deck/sections";
import { formatLagos, lagosDate } from "@/lib/time";

export const runtime = "nodejs";
export const maxDuration = 60;

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function activeUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, error: new NextResponse("Sign in first.", { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("active").eq("id", user.id).maybeSingle();
  if (!me?.active) return { supabase, error: new NextResponse("Your account is not active yet.", { status: 403 }) };
  return { supabase, error: null };
}

async function deckResponse(scope: DeckScope) {
  const data = await loadDeckData(scope);
  const logo = await readFile(path.join(process.cwd(), "public", "chivita-logo.png"));
  const buf = await buildDeck(data, `image/png;base64,${logo.toString("base64")}`, formatLagos(new Date()));
  const name = `CHI_Utility_${scope.title}_${scope.from}_to_${scope.to}.pptx`.replace(/[^\w.-]+/g, "_");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  });
}

/** POST the Reports form → a .pptx built from live data (as the signed-in user, so access rules apply). */
export async function POST(req: NextRequest) {
  const { error } = await activeUser();
  if (error) return error;
  const f = await req.formData();
  const template = String(f.get("template") ?? "weekly");
  const today = lagosDate(new Date());
  const to = isDate(String(f.get("to"))) && String(f.get("to")) <= today ? String(f.get("to")) : today;
  const from = isDate(String(f.get("from"))) && String(f.get("from")) <= to ? String(f.get("from")) : to;
  const sections = SECTION_KEYS.filter((k) => f.get(`s:${k}`) === "on");
  if (!sections.length) return new NextResponse("Tick at least one section.", { status: 400 });
  const area = String(f.get("area") ?? "");
  const commentary: Partial<Record<SectionKey, string>> = {};
  for (const k of sections) {
    const c = String(f.get(`c:${k}`) ?? "").trim();
    if (c) commentary[k] = c.slice(0, 1200);
  }
  return deckResponse({
    template: TEMPLATES[template] ? template : "custom",
    title: String(f.get("title") ?? "").trim().slice(0, 120) || (TEMPLATES[template]?.name ?? "Utility report"),
    from, to, area: area === "U1" || area === "U2" ? area : "", sections, commentary,
  });
}

/** GET /reports/deck?saved=<template id> → the saved template for its rolling period (links in scheduled messages). */
export async function GET(req: NextRequest) {
  const { supabase, error } = await activeUser();
  if (error) return error;
  const id = req.nextUrl.searchParams.get("saved") ?? "";
  const { data: t } = await supabase.from("deck_templates").select("name, template, title, sections, area, period").eq("id", id).eq("active", true).maybeSingle();
  if (!t) return new NextResponse("Saved report not found (or not shared with you).", { status: 404 });
  const period = (t.period in PERIODS ? t.period : "last_week") as Period;
  const { from, to } = periodDates(period, lagosDate(new Date()));
  return deckResponse({
    template: TEMPLATES[t.template] ? t.template : "custom", title: t.title || t.name, from, to,
    area: t.area === "U1" || t.area === "U2" ? t.area : "",
    sections: SECTION_KEYS.filter((k) => (t.sections as string[]).includes(k)), commentary: {},
  });
}
