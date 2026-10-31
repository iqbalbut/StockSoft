import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// Standard PDF fonts only cover WinAnsi (Latin-1 + a few typographic marks).
const CP1252_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
export function winAnsi(s: string | null | undefined): string {
  if (!s) return "";
  return [...s.normalize("NFKD").replace(/[̀-ͯ]/g, "")]
    .map((ch) => {
      const c = ch.charCodeAt(0);
      if (ch === "\n" || ch === "\t") return " ";
      if ((c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.has(ch)) return ch;
      if (ch === "₨") return "Rs";
      if (ch === "−") return "-";
      return "?";
    })
    .join("");
}

export const LETTER: [number, number] = [612, 792];
const INK = rgb(0.06, 0.09, 0.16);
const MUTED = rgb(0.39, 0.45, 0.55);
export const BRAND = rgb(0.12, 0.34, 0.82);

/** Minimal flowing-layout writer on top of pdf-lib. */
export class Writer {
  page!: PDFPage;
  y = 0;
  margin = 50;
  constructor(public doc: PDFDocument, public font: PDFFont, public bold: PDFFont, private footer?: string) {}

  static async create(footer?: string) {
    const doc = await PDFDocument.create();
    const w = new Writer(doc, await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold), footer);
    w.newPage();
    return w;
  }

  get width() {
    return this.page.getWidth() - this.margin * 2;
  }

  newPage() {
    this.page = this.doc.addPage(LETTER);
    this.y = this.page.getHeight() - this.margin;
    if (this.footer) {
      const n = this.doc.getPageCount();
      this.page.drawText(winAnsi(`${this.footer} · page ${n}`), { x: this.margin, y: 25, size: 8, font: this.font, color: MUTED });
    }
  }

  ensure(h: number) {
    if (this.y - h < this.margin) this.newPage();
  }

  text(s: string, o: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; gap?: number; maxWidth?: number } = {}) {
    const size = o.size ?? 10;
    const font = o.bold ? this.bold : this.font;
    const lines = this.wrap(winAnsi(s), font, size, o.maxWidth ?? this.width - (o.x ?? 0));
    for (const line of lines) {
      this.ensure(size + 4);
      this.y -= size + 2;
      this.page.drawText(line, { x: this.margin + (o.x ?? 0), y: this.y, size, font, color: o.color ?? INK });
    }
    this.y -= o.gap ?? 4;
  }

  wrap(s: string, font: PDFFont, size: number, max: number): string[] {
    const out: string[] = [];
    let cur = "";
    for (const word of s.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= max || !cur) cur = next;
      else (out.push(cur), (cur = word));
    }
    out.push(cur);
    return out.map((l) => this.clip(l, font, size, max));
  }

  /** Shortens with an ellipsis only when the text doesn't fit. */
  clip(s: string, font: PDFFont, size: number, max: number) {
    if (font.widthOfTextAtSize(s, size) <= max) return s;
    while (s.length > 1 && font.widthOfTextAtSize(s + "…", size) > max) s = s.slice(0, -1);
    return s + "…";
  }

  /** One table row; columns are [text, width, align]. */
  row(cols: [string, number, ("left" | "right")?][], o: { bold?: boolean; size?: number; shade?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const size = o.size ?? 9;
    const font = o.bold ? this.bold : this.font;
    this.ensure(size + 8);
    if (o.shade) this.page.drawRectangle({ x: this.margin - 4, y: this.y - size - 5, width: this.width + 8, height: size + 8, color: rgb(0.93, 0.95, 0.99) });
    this.y -= size + 3;
    let x = this.margin;
    for (const [raw, w, align] of cols) {
      const t = this.clip(winAnsi(raw), font, size, w - 6);
      const tw = font.widthOfTextAtSize(t, size);
      this.page.drawText(t, { x: align === "right" ? x + w - tw - 4 : x, y: this.y, size, font, color: o.color ?? INK });
      x += w;
    }
    this.y -= 4;
  }

  rule(color = rgb(0.85, 0.87, 0.9)) {
    this.ensure(6);
    this.page.drawLine({ start: { x: this.margin, y: this.y }, end: { x: this.margin + this.width, y: this.y }, thickness: 0.6, color });
    this.y -= 6;
  }

  space(h: number) {
    this.y -= h;
  }
}

export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const amt = (v: string | number | null, cur: string | null) =>
  v == null ? "-" : `${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur ?? ""}`.trim();
