import ExcelJS from "exceljs";
import { CATEGORIES, type Category } from "@/extraction/schema";
import type { YearData, LedgerRow } from "./data";

const esc = (v: unknown) => {
  const s = v == null ? "" : String(v);
  // Quote when needed; neutralise spreadsheet formula injection from document text.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";

const label = (c: string) => CATEGORIES[c as Category]?.label ?? c;
const mdy = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Generic ledger CSV: every posting including reversals, so it reconciles exactly. */
export function ledgerCsv(y: YearData) {
  return toCsv([
    ["Date", "Type", "Category", "Schedule C line", "Description", "Amount", "Currency", "Amount USD", "FX rate (per USD)", "Tax", "Billable", "Client", "Reversal of", "Document ID", "Receipt file"],
    ...y.rows.map((r) => [
      r.entryDate, r.kind, label(r.category), CATEGORIES[r.category as Category]?.scheduleC ?? "", r.description, r.amount, r.currency, r.amountUsd ?? "",
      r.fxRate ?? "", r.taxAmount ?? "", r.isBillable ? "yes" : "no", r.clientId ? y.clientName.get(r.clientId) ?? "" : "", r.reversalOf ?? "", r.documentId, r.doc.archivedFilename ?? "",
    ]),
  ]);
}

/**
 * QuickBooks Online "bank transactions" 3-column import (Banking → Upload transactions). One file per
 * currency: QBO bank accounts are single-currency. Category goes in the description so the bank rule /
 * "For review" screen can assign the QBO account.
 */
export function qboBankCsv(y: YearData, currency: string) {
  return toCsv([
    ["Date", "Description", "Amount"],
    ...y.rows
      .filter((r) => r.currency === currency)
      .map((r) => [mdy(r.entryDate), `${r.description} | ${label(r.category)}${r.reversalOf ? " | REVERSAL" : ""}`, (r.kind === "expense" ? -1 : 1) * Number(r.amount)]),
  ]);
}

/** QuickBooks Online invoice import (Sales → Import invoices). */
export function qboInvoicesCsv(y: YearData) {
  return toCsv([
    ["InvoiceNo", "Customer", "InvoiceDate", "DueDate", "ItemDescription", "ItemAmount", "Currency"],
    ...y.live.filter((r) => r.kind === "revenue").map((r) => [r.doc.docNumber ?? r.documentId.slice(0, 8), r.description, mdy(r.doc.docDate ?? r.entryDate), mdy(r.doc.dueDate ?? r.entryDate), r.doc.notes ?? "Services", r.amount, r.currency]),
  ]);
}

/** Xero bills (Business → Bills to pay → Import) or sales invoices (Invoices → Import) template. */
export function xeroCsv(y: YearData, kind: "bills" | "sales") {
  const codes = y.settings.accountCodes;
  const rows = y.live.filter((r) => (kind === "sales" ? r.kind === "revenue" : r.kind === "expense"));
  return toCsv([
    ["*ContactName", "EmailAddress", "*InvoiceNumber", "Reference", "*InvoiceDate", "*DueDate", "Description", "*Quantity", "*UnitAmount", "*AccountCode", "*TaxType", "Currency", "TrackingName1", "TrackingOption1"],
    ...rows.map((r) => [
      r.description, "", r.doc.docNumber || `RV-${r.documentId.slice(0, 8)}`, r.doc.archivedFilename ?? "", dmy(r.doc.docDate ?? r.entryDate), dmy(r.doc.dueDate ?? r.doc.docDate ?? r.entryDate),
      `${label(r.category)}${r.doc.notes ? `: ${r.doc.notes.slice(0, 100)}` : ""}`, 1, r.amount, codes[r.category] ?? codes.other, "Tax Exempt", r.currency,
      r.clientId ? "Client" : "", r.clientId ? y.clientName.get(r.clientId) ?? "" : "",
    ]),
  ]);
}

/** Excel workbook: Summary, Schedule C, Ledger (with links to receipt files), Monthly. */
export async function workbook(y: YearData, opts: { receiptPath?: (r: LedgerRow) => string | null } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "ReceiptVault";
  wb.created = new Date();
  const money = '#,##0.00;[Red]-#,##0.00';
  const head = (ws: ExcelJS.Worksheet) => {
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEFC" } };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  const s = wb.addWorksheet("Summary");
  s.columns = [{ width: 38 }, { width: 18 }];
  s.addRows([
    [`${y.settings.companyName}: tax year ${y.year}`],
    [`Generated ${y.generatedAt.slice(0, 10)} by ReceiptVault · ${y.settings.accountingBasis} basis · amounts in USD at historical rates`],
    [],
    ["Gross receipts (revenue)", y.totals.revenue],
    ["Total expenses", y.totals.expenses],
    ["Deductible expenses (meals at 50%)", y.totals.deductible],
    ["Net profit (revenue − deductible)", y.totals.net],
    [],
    ["Ledger lines without a USD amount", y.totals.missingUsd],
  ]);
  s.getRow(1).font = { bold: true, size: 14 };
  for (const r of [4, 5, 6, 7]) s.getCell(`B${r}`).numFmt = money;

  const c = wb.addWorksheet("Schedule C");
  c.columns = [
    { header: "Schedule C line", key: "line", width: 42 },
    { header: "Category", key: "label", width: 32 },
    { header: "Documents", key: "count", width: 11 },
    { header: "Total USD", key: "usd", width: 14, style: { numFmt: money } },
    { header: "Deductible USD", key: "ded", width: 15, style: { numFmt: money } },
  ];
  head(c);
  for (const k of y.categories) c.addRow({ line: k.scheduleC, label: k.label, count: k.count, usd: k.usd, ded: k.deductibleUsd });
  c.addRow({ line: "Total", usd: y.totals.expenses, ded: y.totals.deductible }).font = { bold: true };

  const l = wb.addWorksheet("Ledger");
  l.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Type", key: "kind", width: 9 },
    { header: "Category", key: "cat", width: 26 },
    { header: "Description", key: "desc", width: 34 },
    { header: "Amount", key: "amount", width: 13, style: { numFmt: money } },
    { header: "Cur", key: "cur", width: 6 },
    { header: "USD", key: "usd", width: 12, style: { numFmt: money } },
    { header: "FX/USD", key: "fx", width: 11 },
    { header: "Client", key: "client", width: 20 },
    { header: "Status", key: "status", width: 11 },
    { header: "Receipt", key: "receipt", width: 44 },
  ];
  head(l);
  for (const r of y.rows) {
    const path = opts.receiptPath?.(r) ?? null;
    const row = l.addRow({
      date: r.entryDate, kind: r.kind, cat: label(r.category), desc: r.description, amount: Number(r.amount), cur: r.currency,
      usd: r.amountUsd == null ? null : Number(r.amountUsd), fx: r.fxRate ? Number(r.fxRate) : null,
      client: r.clientId ? y.clientName.get(r.clientId) ?? "" : "", status: r.reversalOf ? "reversal" : r.reversed ? "reversed" : "posted",
      receipt: path ? { text: path.split("/").pop()!, hyperlink: path } : r.doc.archivedFilename ?? "",
    });
    if (r.reversed) row.font = { color: { argb: "FF888888" }, strike: !r.reversalOf };
    if (path) row.getCell("receipt").font = { color: { argb: "FF1F57D1" }, underline: true };
  }
  l.autoFilter = { from: "A1", to: "K1" };

  const m = wb.addWorksheet("Monthly");
  m.columns = [
    { header: "Month", key: "month", width: 10 },
    { header: "Revenue USD", key: "revenue", width: 14, style: { numFmt: money } },
    { header: "Expenses USD", key: "expenses", width: 14, style: { numFmt: money } },
  ];
  head(m);
  y.months.forEach((x) => m.addRow(x));

  return Buffer.from(await wb.xlsx.writeBuffer());
}
