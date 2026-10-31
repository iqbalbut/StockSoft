const SUFFIXES = /\b(inc|llc|l\.l\.c|ltd|limited|pvt|private|co|corp|corporation|company|plc|gmbh|fze|fzco|llp|the)\b\.?/g;

/** Canonical vendor key used for vendor rules and fuzzy duplicate matching. */
export function normalizeVendor(name: string | null | undefined): string {
  if (!name) return "";
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\(.*?\)/g, " ")
    .replace(SUFFIXES, " ")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/html": "html",
};
export const extForMime = (mime: string) => EXT_BY_MIME[mime] ?? "bin";

/** YYYY-MM-DD_Vendor_Amount_Currency.ext, e.g. 2026-09-14_LahoreGrillHouse_5508.40_PKR.jpg */
export function archivedName(d: { docDate: string | null; vendorName: string | null; total: string | number | null; currency: string | null }, ext: string) {
  const date = d.docDate ?? "0000-00-00";
  const vendor =
    (d.vendorName ?? "Unknown")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9 ]+/g, " ")
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("")
      .slice(0, 40) || "Unknown";
  const amount = d.total == null ? "0.00" : Number(d.total).toFixed(2);
  return `${date}_${vendor}_${amount}_${d.currency ?? "XXX"}.${ext}`;
}
