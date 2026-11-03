/**
 * Deck look and feel. This is the ONE place to change when the corporate PowerPoint template arrives:
 * colours, fonts, logo, and the master slide (header band, footer with data period and "generated at").
 */
export const THEME = {
  red: "E30613",
  blue: "1D3F8F",
  dark: "1F2937",
  grey: "6B7280",
  light: "F3F4F6",
  ok: "15803D",
  warn: "B45309",
  crit: "B91C1C",
  font: "Calibri",
  logoPath: "public/chivita-logo.png", // 200×51 px
  logoW: 1.57, // inches (keeps 200:51)
  logoH: 0.4,
  master: "CHI_MASTER",
};

/** Slide size: 13.33 × 7.5 in (16:9). */
export const W = 13.33;
export const H = 7.5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defineMaster(pptx: any, logoData: string, footer: string) {
  pptx.defineSlideMaster({
    title: THEME.master,
    background: { color: "FFFFFF" },
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.08, fill: { color: THEME.red } } },
      { image: { x: W - THEME.logoW - 0.35, y: 0.22, w: THEME.logoW, h: THEME.logoH, data: logoData } },
      { line: { x: 0.4, y: H - 0.5, w: W - 0.8, h: 0, line: { color: "D1D5DB", width: 0.75 } } },
      { text: { text: footer, options: { x: 0.4, y: H - 0.45, w: W - 2, h: 0.3, fontFace: THEME.font, fontSize: 9, color: THEME.grey } } },
    ],
    slideNumber: { x: W - 0.9, y: H - 0.45, w: 0.5, h: 0.3, fontFace: THEME.font, fontSize: 9, color: THEME.grey },
  });
}
