import sharp from "sharp";

export type Page = { mimeType: string; data: Buffer };
export type PreparedPage =
  | { kind: "image"; mediaType: "image/jpeg"; data: Buffer }
  | { kind: "pdf"; data: Buffer }
  | { kind: "text"; text: string };

/** Email bodies (HTML e-receipts) are sent as plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

const MAX_EDGE = 2000; // Claude downsamples beyond ~1568px; 2000 keeps small print legible after crop.

/**
 * Prepares a page for the model. The original file is stored untouched; this only produces the copy sent
 * for extraction: EXIF auto-rotate, trim flat borders around the paper, stretch contrast (rescues faded
 * thermal paper) and cap the size.
 */
export async function preparePage(page: Page): Promise<PreparedPage> {
  if (page.mimeType === "application/pdf") return { kind: "pdf", data: page.data };
  if (page.mimeType === "text/html") return { kind: "text", text: htmlToText(page.data.toString("utf8")).slice(0, 100_000) };
  if (page.mimeType === "text/plain") return { kind: "text", text: page.data.toString("utf8").slice(0, 100_000) };
  let img = sharp(page.data, { failOn: "none" }).rotate();
  try {
    // Trim uniform background (table/desk) around the receipt; harmless when there is none.
    const trimmed = await img.clone().trim({ threshold: 30 }).toBuffer({ resolveWithObject: true });
    if (trimmed.info.width > 200 && trimmed.info.height > 200) img = sharp(trimmed.data);
  } catch {
    // trim fails on single-colour images; keep the untrimmed copy
  }
  const data = await img
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .normalise({ lower: 1, upper: 99 })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { kind: "image", mediaType: "image/jpeg", data };
}

/** Small JPEG for list views. */
export async function thumbnail(page: Page): Promise<Buffer | null> {
  if (!page.mimeType.startsWith("image/")) return null;
  return sharp(page.data, { failOn: "none" }).rotate().resize({ width: 480, height: 480, fit: "inside" }).jpeg({ quality: 70 }).toBuffer();
}
