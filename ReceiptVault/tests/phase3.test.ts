import "./setup-env";
import { describe, it, expect, beforeAll } from "vitest";
import nodemailer from "nodemailer";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ingest } from "@/pipeline/ingest";
import { processDocument } from "@/pipeline/process";
import { approveDocument } from "@/pipeline/documents";
import { markPaid } from "@/pipeline/payables";
import { claimJob, completeJob } from "@/pipeline/jobs";
import { readStatementCsv, parseDate, parseAmount, parseCsv } from "@/bank/csv";
import { importStatement } from "@/bank/import";
import { reconciliationGaps, nameScore, confirmMatch } from "@/bank/match";
import { createDraft, billableLines, issueInvoice, sendInvoice, voidInvoice, loadInvoice, invoicePdf } from "@/invoices/invoices";
import { yearData } from "@/reports/data";
import { ledgerCsv, xeroCsv, toCsv } from "@/reports/exports";
import { taxPackage } from "@/reports/tax-package";
import { setMailTransport } from "@/lib/mailer";
import { getSettings, saveSettings } from "@/lib/settings";
import { TEST_CASES } from "@/extraction/test-cases";
import { stubFx, fakeJpeg } from "./helpers";
import fs from "node:fs";

const actor = { type: "user" as const, id: "00000000-0000-0000-0000-000000000003" };
const mails: { to: string; attachments?: { filename: string }[] }[] = [];
const ids: Record<string, string> = {};

async function add(caseId: string, realImage = false) {
  const c = TEST_CASES.find((x) => x.id === caseId)!;
  const data = realImage ? fs.readFileSync(`fixtures/images/${caseId}.jpg`) : fakeJpeg(caseId);
  const r = await ingest({ files: [{ name: c.filename, data }], source: "upload", actor });
  for (let j = await claimJob(); j; j = await claimJob()) {
    await processDocument((j.payload as { documentId: string }).documentId, { fx: stubFx });
    await completeJob(j.id);
  }
  return (ids[caseId] = r.documents[0].id);
}
const doc = async (id: string) => (await getDb()).query.documents.findFirst({ where: eq(schema.documents.id, id) });
const csvFile = (name: string, text: string) => ({ name, data: Buffer.from(text) });

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.users).values({ id: actor.id, email: "ceo@example.com", passwordHash: "x" });
  const [acme] = await db.insert(schema.clients).values({ name: "Acme Retail", code: "ACME", email: "ap@acme.example" }).returning();
  ids.acme = acme.id;
  const t = nodemailer.createTransport({ jsonTransport: true });
  const orig = t.sendMail.bind(t);
  t.sendMail = ((m: (typeof mails)[number]) => (mails.push(m), orig(m))) as typeof t.sendMail;
  setMailTransport(t);
  await add("01-saas-invoice-usd", true); // USD card, Oct 1
  await add("02-restaurant-pkr", true); // PKR card, Sep 14
  await add("05-pkr-internet-bill", true); // PKR bill, unpaid
  await add("07-faded-thermal-aed", true); // AED taxi on a USD card, Aug 22
  await add("08-handwritten-contractor"); // billable to Acme (needs review)
  await approveDocument(ids["08-handwritten-contractor"], actor);
});

describe("CSV statements", () => {
  it("parses quotes, delimiters, dates and amounts", () => {
    expect(parseCsv('a,"b, c","d ""q"""\n1,2,3')).toEqual([["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
    expect(parseCsv("x;y\n1;2")[1]).toEqual(["1", "2"]);
    expect(parseDate("14/09/2026", true)).toBe("2026-09-14");
    expect(parseDate("03/04/2026", false)).toBe("2026-03-04");
    expect(parseDate("03/04/2026", true)).toBe("2026-04-03");
    expect(parseDate("14-Sep-2026", false)).toBe("2026-09-14");
    expect(parseDate("Sep 14, 2026", true)).toBe("2026-09-14");
    expect(parseAmount("(1,250.50)")).toBe(-1250.5);
    expect(parseAmount("45.00 DR")).toBe(-45);
    expect(parseAmount("PKR 5,508.40")).toBe(5508.4);
    expect(parseAmount("abc")).toBeNull();
  });

  it("detects debit/credit columns and day-first order from the data", () => {
    const r = readStatementCsv("Bank XYZ statement\nTxn Date,Narration,Debit,Credit,Balance\n25/09/2026,POS FOO,1000.00,,9000\n02/10/2026,IBFT IN,,500,9500\n", { dayFirst: false });
    expect(r.dayFirst).toBe(true);
    expect(r.transactions).toEqual([
      { date: "2026-09-25", description: "POS FOO", amount: -1000 },
      { date: "2026-10-02", description: "IBFT IN", amount: 500 },
    ]);
  });

  it("scores bank narrations against vendor names", () => {
    expect(nameScore("POS 7710 LAHORE GRILL HOUSE LHR PK", "Lahore Grill House")).toBe(1);
    expect(nameScore("DUBAI TAXI CORP DUBAI ARE", "Dubai Taxi Corporation")).toBeGreaterThan(0.6);
    expect(nameScore("AMAZON WEB SERVICES", "Lahore Grill House")).toBe(0);
  });
});

describe("bank matching", () => {
  it("auto-matches a PKR account statement and marks the bill paid", async () => {
    const r = await importStatement({
      file: csvFile("meezan.csv", "Date,Description,Debit,Credit\n15/09/2026,POS 7710 LAHORE GRILL HOUSE LHR,\"5,508.40\",\n18/10/2026,IBFT NETLINK BROADBAND,8723.50,\n20/10/2026,ATM CASH WITHDRAWAL,10000.00,\n"),
      currency: "PKR",
      accountLast4: "7710",
      actor,
    });
    expect(r.imported).toBe(3);
    expect(r.matched).toBe(2);
    const db = await getDb();
    const grill = await db.query.bankTransactions.findFirst({ where: eq(schema.bankTransactions.documentId, ids["02-restaurant-pkr"]) });
    expect(grill?.matchStatus).toBe("matched");
    const bill = await doc(ids["05-pkr-internet-bill"]);
    expect(bill!.paidAt).toBe("2026-10-18");
    expect(bill!.paymentRef).toMatch(/NETLINK/);
  });

  it("re-importing an overlapping statement doesn't duplicate transactions", async () => {
    const r = await importStatement({ file: csvFile("meezan-again.csv", "Date,Description,Debit,Credit\n15/09/2026,POS 7710 LAHORE GRILL HOUSE LHR,\"5,508.40\",\n"), currency: "PKR", accountLast4: "7710", actor });
    expect(r.imported).toBe(0);
    expect(r.duplicates).toBe(1);
  });

  it("matches a foreign-currency receipt to a USD card charge (bank FX markup) and flags gaps both ways", async () => {
    const r = await importStatement({
      file: csvFile("amex.csv", "Date,Description,Amount\n08/22/2026,DUBAI TAXI CORP DUBAI ARE,-20.95\n09/03/2026,AMAZON WEB SERVICES AWS.AMAZON.CO,-38.12\n10/04/2026,PAYMENT THANK YOU,500.00\n"),
      currency: "USD",
      accountLast4: "1009",
      dayFirst: false,
      actor,
    });
    expect(r.matched).toBe(1);
    const gaps = await reconciliationGaps();
    expect(gaps.missingReceipts.map((t) => t.description)).toContain("AMAZON WEB SERVICES AWS.AMAZON.CO");
    expect(gaps.missingReceipts.map((t) => t.description)).toContain("ATM CASH WITHDRAWAL");
    // CloudNimbus (card, Oct 1) is inside the statements' periods but on no statement.
    expect(gaps.notOnStatement.map((d) => d.id)).toContain(ids["01-saas-invoice-usd"]);
  });

  it("confirms a manual match and refuses to reuse a document", async () => {
    const db = await getDb();
    const aws = await db.query.bankTransactions.findFirst({ where: eq(schema.bankTransactions.description, "AMAZON WEB SERVICES AWS.AMAZON.CO") });
    await confirmMatch(aws!.id, ids["01-saas-invoice-usd"], actor);
    const atm = await db.query.bankTransactions.findFirst({ where: eq(schema.bankTransactions.description, "ATM CASH WITHDRAWAL") });
    await expect(confirmMatch(atm!.id, ids["01-saas-invoice-usd"], actor)).rejects.toThrow(/already matched/);
  });
});

describe("invoices", () => {
  it("drafts from billable expenses, numbers on issue, records revenue, emails the PDF, and voids cleanly", async () => {
    await saveSettings({ invoicePrefix: "AIN", paymentInstructions: "Wise USD account 12345678\nRouting 026073150" });
    const { currency, lines } = await billableLines(ids.acme, 10);
    expect(currency).toBe("PKR");
    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(27500); // 25,000 + 10% markup
    const draft = await createDraft({ clientId: ids.acme, currency, taxRate: 0, lines: [...lines, { description: "Consulting, October", quantity: 10, unitPrice: 15000 }] }, actor);
    const { inv } = (await loadInvoice(draft))!;
    expect(Number(inv.total)).toBe(177500);
    expect(inv.number).toBeNull();

    const issued = await issueInvoice(draft, actor, { fx: stubFx });
    expect(issued.number).toBe("AIN-2026-001");
    const salesDoc = await doc(issued.documentId!);
    expect(salesDoc).toMatchObject({ docType: "sales_invoice", status: "approved", currency: "PKR", docNumber: "AIN-2026-001" });
    expect((await doc(ids["08-handwritten-contractor"]))!.rebilledAt).not.toBeNull();

    // Cash basis: revenue posts when paid.
    const db = await getDb();
    const ledger = () => db.query.ledgerEntries.findMany({ where: eq(schema.ledgerEntries.documentId, issued.documentId!) });
    expect(await ledger()).toHaveLength(0);
    await markPaid(issued.documentId!, { paidAt: "2026-10-30" }, actor);
    expect((await ledger())[0]).toMatchObject({ kind: "revenue", entryDate: "2026-10-30" });

    mails.length = 0;
    await sendInvoice(draft, actor);
    expect(mails[0].to).toBe("ap@acme.example");
    expect(mails[0].attachments?.[0].filename).toBe("AIN-2026-001.pdf");

    const second = await createDraft({ clientId: ids.acme, currency: "USD", taxRate: 5, lines: [{ description: "Support", quantity: 1, unitPrice: 100 }] }, actor);
    expect((await issueInvoice(second, actor, { fx: stubFx })).number).toBe("AIN-2026-002");

    await voidInvoice(draft, actor);
    expect((await doc(issued.documentId!))!.status).toBe("rejected");
    expect((await doc(ids["08-handwritten-contractor"]))!.rebilledAt).toBeNull();
    const net = (await ledger()).reduce((a, r) => a + Number(r.amount), 0);
    expect(net).toBeCloseTo(0);
  });

  it("renders a valid PDF with Latin-1-safe text", async () => {
    const { inv, lines, client } = (await loadInvoice((await (await getDb()).query.invoices.findFirst())!.id))!;
    const pdf = await invoicePdf(inv, lines, { ...client, name: "مکتبہ Acme — Ltd" }, await getSettings());
    const parsed = await PDFDocument.load(pdf);
    expect(parsed.getPageCount()).toBe(1);
  });
});

describe("reports and exports", () => {
  it("escapes CSV and neutralises formula injection", () => {
    expect(toCsv([["=HYPERLINK(1)", 'a"b', "-12.50", "x,y"]])).toBe(`'=HYPERLINK(1),"a""b",-12.50,"x,y"\r\n`);
  });

  it("computes Schedule C totals with meals at 50%", async () => {
    const y = await yearData(2026);
    const meals = y.categories.find((c) => c.category === "meals")!;
    expect(meals.deductibleUsd).toBeCloseTo(meals.usd / 2, 2);
    expect(y.totals.deductible).toBeLessThan(y.totals.expenses);
    expect(ledgerCsv(y).split("\r\n")[0]).toMatch(/^Date,Type,Category,Schedule C line/);
    const xero = xeroCsv(y, "bills").split("\r\n");
    expect(xero[0]).toMatch(/^\*ContactName/);
    expect(xero.some((l) => l.includes(",485,") || l.includes(",489,"))).toBe(true); // software / telecom account codes
  });

  it("builds the tax package ZIP: PDF with receipt appendix, Excel with receipt links, imports, originals", async () => {
    const buf = await taxPackage(2026);
    const zip = await JSZip.loadAsync(buf);
    const names = Object.keys(zip.files);
    const root = "tax-package-2026/";
    for (const f of ["summary-2026.pdf", "ledger-2026.xlsx", "ledger-2026.csv", "README.txt", "accounting-imports/xero-bills-2026.csv", "accounting-imports/quickbooks-bank-PKR-2026.csv"]) {
      expect(names).toContain(root + f);
    }
    const receipts = names.filter((n) => n.startsWith(root + "receipts/") && !n.endsWith("/"));
    expect(receipts.length).toBeGreaterThanOrEqual(4);
    expect(receipts.some((n) => /2026-09-14_LahoreGrillHouse_5508\.40_PKR\.jpg$/.test(n))).toBe(true);

    const pdf = await PDFDocument.load(await zip.file(root + "summary-2026.pdf")!.async("uint8array"));
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(2 + receipts.length - 1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await zip.file(root + "ledger-2026.xlsx")!.async("nodebuffer")) as never);
    const sheet = wb.getWorksheet("Ledger")!;
    const links: string[] = [];
    sheet.eachRow((row) => {
      const v = row.getCell(11).value as { hyperlink?: string } | null;
      if (v && typeof v === "object" && v.hyperlink) links.push(v.hyperlink);
    });
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) expect(names).toContain(root + l);
    expect(wb.getWorksheet("Schedule C")).toBeTruthy();
  });
});
