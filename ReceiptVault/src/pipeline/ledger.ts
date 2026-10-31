import { and, eq, desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSettings, type AppSettings } from "@/lib/settings";
import { audit, type Actor } from "@/lib/audit";

type Doc = typeof schema.documents.$inferSelect;
type Entry = typeof schema.ledgerEntries.$inferInsert;

/**
 * What the ledger should contain for a document right now, or null if nothing.
 * - Only approved business documents post. Personal, rejected, duplicate and non-financial documents don't.
 * - Receipts post on their date (already paid).
 * - Vendor bills and sales invoices post on the document date under accrual, or on the paid date under cash.
 */
export function desiredPosting(doc: Doc, basis: AppSettings["accountingBasis"]): Omit<Entry, "documentId" | "createdBy"> | null {
  if (doc.status !== "approved" || doc.isBusiness === false) return null;
  if (!doc.docType || !["expense_receipt", "vendor_bill", "sales_invoice"].includes(doc.docType)) return null;
  if (doc.total == null || !doc.currency || !doc.docDate) return null;
  const deferred = doc.docType !== "expense_receipt" && basis === "cash";
  if (deferred && !doc.paidAt) return null;
  const amount = deferred && doc.paidAmount != null ? doc.paidAmount : doc.total;
  const usd = doc.fxRate ? Math.round((Number(amount) / Number(doc.fxRate)) * 100) / 100 : doc.totalUsd != null && amount === doc.total ? Number(doc.totalUsd) : null;
  return {
    entryDate: deferred ? doc.paidAt! : doc.docDate,
    kind: doc.docType === "sales_invoice" ? "revenue" : "expense",
    category: doc.docType === "sales_invoice" ? "revenue" : doc.category ?? "other",
    description: doc.vendorName ?? doc.originalFilename,
    amount,
    currency: doc.currency,
    amountUsd: usd == null ? null : String(usd),
    fxRate: doc.fxRate,
    taxAmount: doc.tax,
    isBillable: Boolean(doc.isBillable),
    clientId: doc.clientId,
  };
}

const SAME: (keyof Entry)[] = ["entryDate", "kind", "category", "description", "amount", "currency", "amountUsd", "isBillable", "clientId"];
const norm = (v: unknown) => (v == null ? null : typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);

/**
 * Brings the ledger in line with the document: no-op if the live posting already matches; otherwise the
 * live posting is reversed (negative mirror entry) and, if the document should post, a new entry is added.
 */
export async function syncLedger(documentId: string, actor: Actor = { type: "system" }) {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
  if (!doc) return;
  const want = desiredPosting(doc, (await getSettings()).accountingBasis);
  // Reversed originals and their reversal entries are both flagged `reversed`, so at most one entry is live.
  const current = await db.query.ledgerEntries.findFirst({
    where: and(eq(schema.ledgerEntries.documentId, documentId), eq(schema.ledgerEntries.reversed, false)),
    orderBy: desc(schema.ledgerEntries.id),
  });

  if (current && want && SAME.every((k) => norm(current[k as keyof typeof current]) === norm(want[k as keyof typeof want]))) return;

  await db.transaction(async (tx) => {
    if (current) {
      await tx.update(schema.ledgerEntries).set({ reversed: true }).where(eq(schema.ledgerEntries.id, current.id));
      await tx.insert(schema.ledgerEntries).values({
        ...current,
        id: undefined,
        createdAt: undefined,
        entryDate: want?.entryDate && want.entryDate > current.entryDate ? want.entryDate : new Date().toISOString().slice(0, 10),
        amount: String(-Number(current.amount)),
        amountUsd: current.amountUsd == null ? null : String(-Number(current.amountUsd)),
        taxAmount: current.taxAmount == null ? null : String(-Number(current.taxAmount)),
        reversalOf: current.id,
        reversed: true,
        createdBy: actor.id ?? actor.type,
      });
    }
    if (want) await tx.insert(schema.ledgerEntries).values({ ...want, documentId, createdBy: actor.id ?? actor.type });
  });
  await audit(actor, "ledger", documentId, current ? (want ? "reposted" : "reversed") : "posted", want ? { amount: want.amount, currency: want.currency, date: want.entryDate } : undefined);
}
