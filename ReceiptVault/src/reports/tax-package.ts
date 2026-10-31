import JSZip from "jszip";
import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";
import { asc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getObject } from "@/lib/storage";
import { CATEGORIES, type Category } from "@/extraction/schema";
import { extForMime } from "@/pipeline/naming";
import { yearData, type YearData } from "./data";
import { ledgerCsv, workbook, xeroCsv, qboBankCsv, qboInvoicesCsv } from "./exports";
import { Writer, usd, amt, BRAND, winAnsi } from "./pdf";

type Files = Map<string, { path: string; files: (typeof schema.documentFiles.$inferSelect)[] }>;

/** receipts/<archived name>, de-duplicated, for every document with a live posting in the year. */
async function receiptFiles(y: YearData): Promise<Files> {
  const db = await getDb();
  const docs = [...new Map(y.live.map((r) => [r.documentId, r.doc])).values()];
  if (!docs.length) return new Map();
  const files = await db.query.documentFiles.findMany({ where: inArray(schema.documentFiles.documentId, docs.map((d) => d.id)), orderBy: asc(schema.documentFiles.pageNo) });
  const used = new Set<string>();
  const out: Files = new Map();
  for (const d of docs.sort((a, b) => (a.docDate ?? "").localeCompare(b.docDate ?? ""))) {
    const own = files.filter((f) => f.documentId === d.id);
    if (!own.length) continue;
    let name = (d.archivedFilename ?? `${d.id}.${extForMime(own[0].mimeType)}`).replace(/[^\w.\-]/g, "_");
    for (let i = 2; used.has(name); i++) name = name.replace(/(\.\w+)$/, `-${i}$1`);
    used.add(name);
    out.set(d.id, { path: `receipts/${name}`, files: own });
  }
  return out;
}

async function summaryPdf(y: YearData, receipts: Files) {
  const w = await Writer.create(`${y.settings.companyName} · Tax year ${y.year} · generated ${y.generatedAt.slice(0, 10)}`);
  w.text(winAnsi(y.settings.companyName), { size: 22, bold: true, color: BRAND, gap: 2 });
  w.text(`Tax year ${y.year}: categorized expenses and receipts`, { size: 13, gap: 2 });
  w.text(`Prepared by ReceiptVault on ${y.generatedAt.slice(0, 10)}. ${y.settings.accountingBasis === "cash" ? "Cash" : "Accrual"} basis. All amounts in USD converted at the historical exchange rate on each transaction date; original currency amounts are in the ledger.`, { size: 9, color: rgb(0.39, 0.45, 0.55), gap: 14 });

  const kv = (k: string, v: string, bold = false) => w.row([[k, 330], [v, w.width - 330, "right"]], { size: 11, bold });
  kv("Gross receipts / revenue", usd(y.totals.revenue));
  kv("Total expenses", usd(y.totals.expenses));
  kv("Deductible expenses (business meals at 50%)", usd(y.totals.deductible));
  w.rule();
  kv("Net profit", usd(y.totals.net), true);
  if (y.totals.missingUsd) w.text(`Note: ${y.totals.missingUsd} ledger line(s) have no USD conversion and are excluded from USD totals. See the ledger.`, { size: 9, color: rgb(0.75, 0.4, 0) });
  w.space(14);

  w.text("Expenses by IRS Schedule C line", { size: 13, bold: true, gap: 6 });
  const cols = (a: string, b: string, c: string, d: string, e: string): [string, number, ("left" | "right")?][] => [[a, 170], [b, 150], [c, 50, "right"], [d, 70, "right"], [e, w.width - 440, "right"]];
  w.row(cols("Schedule C line", "Category", "Docs", "Total", "Deductible"), { bold: true, shade: true });
  for (const c of y.categories) w.row(cols(c.scheduleC, c.label, String(c.count), usd(c.usd), usd(c.deductibleUsd)));
  w.rule();
  w.row(cols("Total", "", "", usd(y.totals.expenses), usd(y.totals.deductible)), { bold: true });
  w.space(14);

  w.text("By month", { size: 13, bold: true, gap: 6 });
  w.row([["Month", 120], ["Revenue", 120, "right"], ["Expenses", 120, "right"]], { bold: true, shade: true });
  for (const m of y.months) if (m.revenue || m.expenses) w.row([[m.month, 120], [usd(m.revenue), 120, "right"], [usd(m.expenses), 120, "right"]]);

  w.newPage();
  w.text("Ledger", { size: 13, bold: true, gap: 2 });
  w.text("Every posting in the year. Reversals (corrections) are listed with the line they cancel. Receipt # refers to the appendix and to the receipts/ folder.", { size: 8, color: rgb(0.39, 0.45, 0.55), gap: 6 });
  const order = [...receipts.keys()];
  const lc = (a: string, b: string, c: string, d: string, e: string, f: string): [string, number, ("left" | "right")?][] => [[a, 58], [b, 150], [c, 110], [d, 90, "right"], [e, 65, "right"], [f, w.width - 473, "right"]];
  w.row(lc("Date", "Description", "Category", "Amount", "USD", "Receipt"), { bold: true, shade: true, size: 8 });
  for (const r of y.rows) {
    const idx = order.indexOf(r.documentId);
    w.row(
      lc(r.entryDate, `${r.description}${r.reversalOf ? " (reversal)" : ""}`, CATEGORIES[r.category as Category]?.label ?? r.category, amt(r.amount, r.currency), r.amountUsd == null ? "-" : usd(Number(r.amountUsd)), idx >= 0 ? `#${idx + 1}` : ""),
      { size: 8, color: r.reversed ? rgb(0.55, 0.58, 0.62) : undefined },
    );
  }

  // Appendix: one page per receipt (images scaled to fit; PDF originals copied page by page).
  let n = 0;
  for (const [docId, entry] of receipts) {
    n++;
    const doc = y.live.find((r) => r.documentId === docId)!.doc;
    const header = `Receipt #${n} · ${doc.docDate ?? ""} · ${doc.vendorName ?? ""} · ${amt(doc.total, doc.currency)}${doc.totalUsd && doc.currency !== "USD" ? ` (${usd(Number(doc.totalUsd))})` : ""} · ${CATEGORIES[doc.category as Category]?.label ?? doc.category ?? ""}`;
    for (const f of entry.files) {
      const bytes = await getObject(f.storageKey);
      if (f.mimeType === "application/pdf") {
        try {
          const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
          const pages = await w.doc.copyPages(src, src.getPageIndices().slice(0, 10));
          pages.forEach((p, i) => {
            w.doc.addPage(p);
            if (i === 0) {
              p.drawRectangle({ x: 0, y: p.getHeight() - 22, width: p.getWidth(), height: 22, color: rgb(1, 1, 1), opacity: 0.85 });
              p.drawText(winAnsi(header).slice(0, 140), { x: 10, y: p.getHeight() - 15, size: 8, font: w.bold, color: BRAND });
            }
          });
        } catch {
          w.newPage();
          w.text(header, { bold: true, size: 9, color: BRAND });
          w.text(`Original PDF could not be embedded; see ${entry.path}.`);
        }
        continue;
      }
      w.newPage();
      w.text(`${header}${entry.files.length > 1 ? ` · page ${f.pageNo}` : ""}`, { bold: true, size: 9, color: BRAND, gap: 2 });
      w.text(`File: ${entry.path}`, { size: 8, color: rgb(0.39, 0.45, 0.55), gap: 6 });
      if (f.mimeType.startsWith("image/")) {
        try {
          const jpg = await sharp(bytes, { failOn: "none" }).rotate().resize({ width: 1400, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
          const img = await w.doc.embedJpg(jpg);
          const scale = Math.min(w.width / img.width, (w.y - w.margin) / img.height);
          w.page.drawImage(img, { x: w.margin, y: w.y - img.height * scale, width: img.width * scale, height: img.height * scale });
        } catch {
          w.text(`The image could not be rendered here; the original is in ${entry.path}.`, { size: 9 });
        }
      } else {
        w.text(bytes.toString("utf8").slice(0, 4000), { size: 8 });
      }
    }
  }
  return Buffer.from(await w.doc.save());
}

/** tax-package-YYYY.zip: summary PDF (with receipt appendix), Excel workbook, CSV/Xero/QuickBooks files and original receipts. */
export async function taxPackage(year: number) {
  const y = await yearData(year);
  const receipts = await receiptFiles(y);
  const zip = new JSZip();
  const root = zip.folder(`tax-package-${year}`)!;
  root.file(`summary-${year}.pdf`, await summaryPdf(y, receipts));
  root.file(`ledger-${year}.xlsx`, await workbook(y, { receiptPath: (r) => receipts.get(r.documentId)?.path ?? null }));
  root.file(`ledger-${year}.csv`, ledgerCsv(y));
  const imports = root.folder("accounting-imports")!;
  imports.file(`xero-bills-${year}.csv`, xeroCsv(y, "bills"));
  imports.file(`xero-sales-invoices-${year}.csv`, xeroCsv(y, "sales"));
  imports.file(`quickbooks-invoices-${year}.csv`, qboInvoicesCsv(y));
  for (const cur of new Set(y.rows.map((r) => r.currency))) imports.file(`quickbooks-bank-${cur}-${year}.csv`, qboBankCsv(y, cur));
  for (const [, entry] of receipts) {
    for (const f of entry.files) {
      const path = entry.files.length > 1 && f.pageNo > 1 ? entry.path.replace(/(\.\w+)$/, `_p${f.pageNo}.${extForMime(f.mimeType)}`) : entry.path;
      root.file(path, await getObject(f.storageKey));
    }
  }
  root.file(
    "README.txt",
    [
      `${y.settings.companyName}: tax year ${year} package (generated ${y.generatedAt.slice(0, 10)})`,
      "",
      `summary-${year}.pdf     totals by IRS Schedule C line, monthly totals, full ledger, and every receipt as an appendix page`,
      `ledger-${year}.xlsx     the same data in Excel; the Receipt column links to files in receipts/ (keep the folder structure)`,
      `ledger-${year}.csv      every posting, including reversals, with original currency and USD`,
      "accounting-imports/    files for Xero (Bills / Invoices import) and QuickBooks Online (bank upload, invoice import)",
      "receipts/              original documents, named YYYY-MM-DD_Vendor_Amount_Currency",
      "",
      `Totals: revenue ${usd(y.totals.revenue)}, expenses ${usd(y.totals.expenses)}, deductible ${usd(y.totals.deductible)} (meals at 50%).`,
      "Amounts are converted to USD at the historical rate on each transaction date. Review with your tax preparer before filing.",
    ].join("\r\n"),
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export { summaryPdf, receiptFiles };
