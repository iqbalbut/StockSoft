import { z } from "zod";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSettings, type AppSettings } from "@/lib/settings";
import { audit, type Actor } from "@/lib/audit";
import { putObject } from "@/lib/storage";
import { sha256 } from "@/lib/crypto";
import { sendMail, mailConfigured } from "@/lib/mailer";
import { CONFIDENCE_FIELDS } from "@/extraction/schema";
import { archivedName } from "@/pipeline/naming";
import { defaultFxProvider, toUsd, type FxProvider } from "@/pipeline/fx";
import { retainUntil } from "@/pipeline/process";
import { syncLedger } from "@/pipeline/ledger";
import { Writer, BRAND, winAnsi } from "@/reports/pdf";
import { rgb, degrees } from "pdf-lib";

type Invoice = typeof schema.invoices.$inferSelect;
type Line = typeof schema.invoiceLines.$inferSelect;
type Client = typeof schema.clients.$inferSelect;

const r2 = (n: number) => Math.round(n * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: string, n: number) => iso(new Date(Date.parse(d) + n * 86400_000));

export const InvoiceInput = z.object({
  clientId: z.uuid(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  taxRate: z.number().min(0).max(100).default(0),
  notes: z.string().max(2000).nullable().optional(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(500),
        quantity: z.number().positive().max(1_000_000),
        unitPrice: z.number().min(-1e9).max(1e9),
        sourceDocumentId: z.uuid().nullable().optional(),
      }),
    )
    .min(1)
    .max(200),
});
export type InvoiceInput = z.infer<typeof InvoiceInput>;

function totals(lines: InvoiceInput["lines"], taxRate: number) {
  const subtotal = r2(lines.reduce((a, l) => a + r2(l.quantity * l.unitPrice), 0));
  const tax = r2((subtotal * taxRate) / 100);
  return { subtotal, tax, total: r2(subtotal + tax) };
}

async function writeLines(tx: Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0], invoiceId: string, lines: InvoiceInput["lines"]) {
  await tx.delete(schema.invoiceLines).where(eq(schema.invoiceLines.invoiceId, invoiceId));
  await tx.insert(schema.invoiceLines).values(
    lines.map((l, i) => ({
      invoiceId,
      position: i + 1,
      description: l.description,
      quantity: String(l.quantity),
      unitPrice: String(l.unitPrice),
      amount: String(r2(l.quantity * l.unitPrice)),
      sourceDocumentId: l.sourceDocumentId ?? null,
    })),
  );
}

export async function createDraft(input: InvoiceInput, actor: Actor & { id: string }) {
  const db = await getDb();
  const s = await getSettings();
  const issueDate = input.issueDate ?? iso(new Date());
  const t = totals(input.lines, input.taxRate);
  const id = await db.transaction(async (tx) => {
    const [inv] = await tx
      .insert(schema.invoices)
      .values({
        clientId: input.clientId,
        currency: input.currency,
        issueDate,
        dueDate: input.dueDate ?? addDays(issueDate, s.invoiceDueDays),
        taxRate: String(input.taxRate),
        subtotal: String(t.subtotal),
        tax: String(t.tax),
        total: String(t.total),
        notes: input.notes ?? null,
        createdBy: actor.id,
      })
      .returning();
    await writeLines(tx, inv.id, input.lines);
    return inv.id;
  });
  await audit(actor, "invoice", id, "draft_created", { total: t.total, currency: input.currency });
  return id;
}

export async function updateDraft(id: string, input: InvoiceInput, actor: Actor & { id: string }) {
  const db = await getDb();
  const inv = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
  if (!inv) throw new Error("Invoice not found");
  if (inv.status !== "draft") throw new Error("Issued invoices can't be edited; void it and issue a new one");
  const t = totals(input.lines, input.taxRate);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.invoices)
      .set({ clientId: input.clientId, currency: input.currency, issueDate: input.issueDate ?? inv.issueDate, dueDate: input.dueDate ?? inv.dueDate, taxRate: String(input.taxRate), subtotal: String(t.subtotal), tax: String(t.tax), total: String(t.total), notes: input.notes ?? null, updatedAt: new Date() })
      .where(eq(schema.invoices.id, id));
    await writeLines(tx, id, input.lines);
  });
  await audit(actor, "invoice", id, "draft_updated", { total: t.total });
}

/**
 * Draft lines from a client's approved, not-yet-rebilled billable expenses. If they're all in one currency
 * the invoice uses it; otherwise each line is converted to USD at its historical rate.
 */
export async function billableLines(clientId: string, markupPct = 0) {
  const db = await getDb();
  const docs = await db.query.documents.findMany({
    where: and(eq(schema.documents.clientId, clientId), eq(schema.documents.isBillable, true), eq(schema.documents.status, "approved"), isNull(schema.documents.rebilledAt)),
    orderBy: asc(schema.documents.docDate),
  });
  const currencies = new Set(docs.map((d) => d.currency));
  const currency = currencies.size === 1 ? [...currencies][0] ?? "USD" : "USD";
  const m = 1 + markupPct / 100;
  const lines = docs
    .map((d) => {
      const base = currency === d.currency ? Number(d.total) : d.totalUsd == null ? null : Number(d.totalUsd);
      if (base == null) return null;
      const orig = currency === d.currency ? "" : ` (${Number(d.total).toFixed(2)} ${d.currency})`;
      return { description: `Re-billed expense: ${d.docDate} ${d.vendorName ?? ""}${orig}`.trim(), quantity: 1, unitPrice: r2(base * m), sourceDocumentId: d.id };
    })
    .filter((l): l is NonNullable<typeof l> => l != null);
  return { currency, lines, skipped: docs.length - lines.length };
}

/** Next number for the year: PREFIX-YYYY-NNN (atomic, gap-free per prefix and year). */
export async function nextInvoiceNumber(prefix: string, year: number) {
  const db = await getDb();
  const key = `invoice:${prefix}:${year}`;
  const [row] = await db
    .insert(schema.counters)
    .values({ key, value: 1 })
    .onConflictDoUpdate({ target: schema.counters.key, set: { value: sql`${schema.counters.value} + 1` } })
    .returning();
  return `${prefix}-${year}-${String(row.value).padStart(3, "0")}`;
}

export async function loadInvoice(id: string) {
  const db = await getDb();
  const inv = await db.query.invoices.findFirst({ where: eq(schema.invoices.id, id) });
  if (!inv) return null;
  const lines = await db.query.invoiceLines.findMany({ where: eq(schema.invoiceLines.invoiceId, id), orderBy: asc(schema.invoiceLines.position) });
  const client = (await db.query.clients.findFirst({ where: eq(schema.clients.id, inv.clientId) }))!;
  return { inv, lines, client };
}

const money = (v: string | number, cur: string) => `${cur} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Branded PDF. Drafts carry a DRAFT watermark. */
export async function invoicePdf(inv: Invoice, lines: Line[], client: Client, s: AppSettings) {
  const w = await Writer.create();
  const muted = rgb(0.39, 0.45, 0.55);
  const top = w.y;
  w.page.drawRectangle({ x: 0, y: w.page.getHeight() - 8, width: w.page.getWidth(), height: 8, color: BRAND });
  w.text(s.companyName, { size: 20, bold: true, color: BRAND, gap: 2 });
  if (s.companyAddress) w.text(s.companyAddress, { size: 9, color: muted, gap: 0, maxWidth: 260 });
  if (s.companyEmail) w.text(s.companyEmail, { size: 9, color: muted });
  const right = (t: string, y: number, size = 10, bold = false) => {
    const f = bold ? w.bold : w.font;
    w.page.drawText(winAnsi(t), { x: w.margin + w.width - f.widthOfTextAtSize(winAnsi(t), size), y, size, font: f, color: bold ? BRAND : undefined });
  };
  right("INVOICE", top - 20, 22, true);
  right(inv.number ?? "DRAFT", top - 38, 11, false);
  right(`Issued ${inv.issueDate}`, top - 54, 9);
  right(`Due ${inv.dueDate}`, top - 66, 9);
  w.y = Math.min(w.y, top - 80) - 16;

  w.text("BILL TO", { size: 8, bold: true, color: muted, gap: 0 });
  w.text(client.name, { size: 12, bold: true, gap: 0 });
  if (client.email) w.text(client.email, { size: 9, color: muted });
  w.space(16);

  const cols = (a: string, b: string, c: string, d: string): [string, number, ("left" | "right")?][] => [[a, w.width - 230], [b, 50, "right"], [c, 90, "right"], [d, 90, "right"]];
  w.row(cols("Description", "Qty", "Unit price", "Amount"), { bold: true, shade: true, size: 9 });
  for (const l of lines) w.row(cols(l.description, String(Number(l.quantity)), Number(l.unitPrice).toFixed(2), Number(l.amount).toFixed(2)), { size: 9 });
  w.rule();
  const sum = (k: string, v: string, bold = false) => w.row([["", w.width - 230], [k, 140, "right"], [v, 90, "right"]], { bold, size: bold ? 11 : 9 });
  sum("Subtotal", Number(inv.subtotal).toFixed(2));
  if (Number(inv.taxRate) > 0) sum(`Tax (${Number(inv.taxRate)}%)`, Number(inv.tax).toFixed(2));
  sum(`Total due (${inv.currency})`, money(inv.total, inv.currency), true);
  w.space(18);
  if (inv.notes) {
    w.text("Notes", { size: 9, bold: true, gap: 0 });
    w.text(inv.notes, { size: 9, gap: 10 });
  }
  if (s.paymentInstructions) {
    w.text("How to pay", { size: 9, bold: true, gap: 0 });
    for (const line of s.paymentInstructions.split(/\r?\n/)) w.text(line, { size: 9, gap: 0 });
  }
  if (inv.status === "draft") {
    w.page.drawText("DRAFT", { x: 150, y: 330, size: 110, font: w.bold, color: rgb(0.85, 0.87, 0.92), opacity: 0.45, rotate: degrees(30) });
  }
  return Buffer.from(await w.doc.save());
}

/**
 * Issues a draft: assigns the number, freezes the PDF as an encrypted original, records it as an approved
 * sales-invoice document (so it appears in receivables, the ledger and the tax package) and marks the
 * re-billed expenses as invoiced.
 */
export async function issueInvoice(id: string, actor: Actor & { id: string }, deps: { fx?: FxProvider } = {}) {
  const db = await getDb();
  const loaded = await loadInvoice(id);
  if (!loaded) throw new Error("Invoice not found");
  const { inv, lines, client } = loaded;
  if (inv.status !== "draft") return inv;
  const s = await getSettings();
  const number = await nextInvoiceNumber(s.invoicePrefix, Number(inv.issueDate.slice(0, 4)));
  const issued = { ...inv, number, status: "issued" as const };
  const pdf = await invoicePdf(issued, lines, client, s);
  const fx = await (deps.fx ?? defaultFxProvider)(inv.currency, inv.issueDate).catch(() => null);
  const conf = Object.fromEntries(CONFIDENCE_FIELDS.map((f) => [f, 1]));

  const [doc] = await db
    .insert(schema.documents)
    .values({
      status: "approved",
      source: "invoice",
      sourceRef: number,
      originalFilename: `${number}.pdf`,
      archivedFilename: archivedName({ docDate: inv.issueDate, vendorName: client.name, total: inv.total, currency: inv.currency }, "pdf"),
      sha256: sha256(pdf),
      docType: "sales_invoice",
      vendorName: client.name,
      docNumber: number,
      docDate: inv.issueDate,
      dueDate: inv.dueDate,
      currency: inv.currency,
      subtotal: inv.subtotal,
      tax: inv.tax,
      total: inv.total,
      paymentMethod: "bank_transfer",
      category: "revenue",
      isBusiness: true,
      isBillable: false,
      clientId: client.id,
      fxRate: fx ? String(fx.perUsd) : null,
      fxDate: fx?.rateDate ?? null,
      totalUsd: fx ? String(toUsd(Number(inv.total), fx)) : null,
      fieldConfidence: conf,
      overallConfidence: 1,
      extractionModel: "issued-by-receiptvault",
      approvedBy: actor.id,
      approvedAt: new Date(),
      retainUntil: retainUntil(inv.issueDate, s.retentionYears),
    })
    .returning();
  const key = `invoices/${inv.issueDate.slice(0, 4)}/${doc.id}/${number}.pdf`;
  await putObject(key, pdf);
  await db.insert(schema.documentFiles).values({ documentId: doc.id, pageNo: 1, storageKey: key, mimeType: "application/pdf", sizeBytes: pdf.length, sha256: sha256(pdf) });
  await db.update(schema.invoices).set({ number, status: "issued", documentId: doc.id, updatedAt: new Date() }).where(eq(schema.invoices.id, id));
  const rebilled = lines.map((l) => l.sourceDocumentId).filter((x): x is string => !!x);
  if (rebilled.length) await db.update(schema.documents).set({ rebilledAt: inv.issueDate }).where(inArray(schema.documents.id, rebilled));
  await audit(actor, "invoice", id, "issued", { number, total: inv.total, currency: inv.currency, documentId: doc.id, rebilled: rebilled.length });
  await syncLedger(doc.id, actor);
  return { ...issued, documentId: doc.id };
}

export async function issuedPdf(inv: Invoice) {
  const db = await getDb();
  if (!inv.documentId) return null;
  const f = await db.query.documentFiles.findFirst({ where: eq(schema.documentFiles.documentId, inv.documentId) });
  return f ? (await import("@/lib/storage")).getObject(f.storageKey) : null;
}

/** Emails the issued PDF to the client (issuing the draft first). */
export async function sendInvoice(id: string, actor: Actor & { id: string }, to?: string) {
  if (!mailConfigured()) throw new Error("Email isn't configured (SMTP_URL). Download the PDF and send it yourself.");
  await issueInvoice(id, actor);
  const { inv, client } = (await loadInvoice(id))!;
  const recipient = to || client.email;
  if (!recipient) throw new Error("Add the client's billing email first");
  const s = await getSettings();
  const pdf = (await issuedPdf(inv))!;
  await sendMail({
    to: recipient,
    replyTo: s.companyEmail || undefined,
    subject: `Invoice ${inv.number} from ${s.companyName}`,
    text: `Hello,\n\nPlease find attached invoice ${inv.number} for ${money(inv.total, inv.currency)}, due ${inv.dueDate}.\n${s.paymentInstructions ? `\nHow to pay:\n${s.paymentInstructions}\n` : ""}\nThank you,\n${s.companyName}`,
    attachments: [{ filename: `${inv.number}.pdf`, content: pdf, contentType: "application/pdf" }],
  });
  const db = await getDb();
  await db.update(schema.invoices).set({ sentAt: new Date(), sentTo: recipient }).where(eq(schema.invoices.id, id));
  await audit(actor, "invoice", id, "sent", { to: recipient });
}

/** Voids an issued invoice: its document is rejected (reversing the ledger) and re-billed expenses are freed. */
export async function voidInvoice(id: string, actor: Actor & { id: string }) {
  const db = await getDb();
  const loaded = await loadInvoice(id);
  if (!loaded) throw new Error("Invoice not found");
  const { inv, lines } = loaded;
  if (inv.status === "void") return;
  await db.update(schema.invoices).set({ status: "void", updatedAt: new Date() }).where(eq(schema.invoices.id, id));
  if (inv.documentId) {
    await db.update(schema.documents).set({ status: "rejected", updatedAt: new Date() }).where(eq(schema.documents.id, inv.documentId));
    await syncLedger(inv.documentId, actor);
  }
  const freed = lines.map((l) => l.sourceDocumentId).filter((x): x is string => !!x);
  if (freed.length) await db.update(schema.documents).set({ rebilledAt: null }).where(inArray(schema.documents.id, freed));
  await audit(actor, "invoice", id, "voided", { number: inv.number });
}
