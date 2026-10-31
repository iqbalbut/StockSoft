import { and, eq, gte, inArray, isNotNull, lte, notInArray, sql, ne } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { normalizeVendor } from "@/pipeline/naming";
import { markPaid } from "@/pipeline/payables";

type Txn = typeof schema.bankTransactions.$inferSelect;
type Doc = typeof schema.documents.$inferSelect;

export const AUTO_MATCH = 0.85;
export const SUGGEST = 0.55;
const MAX_DAYS = 10;

const days = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400_000);

/** How well the charged amount fits the document (handles a USD card charged for a PKR receipt). */
export function amountScore(txn: Pick<Txn, "amount" | "currency">, doc: Pick<Doc, "total" | "currency" | "totalUsd" | "category">): number {
  const charged = Math.abs(Number(txn.amount));
  if (doc.total == null) return 0;
  if (doc.currency === txn.currency) {
    const total = Math.abs(Number(doc.total));
    const diff = Math.abs(charged - total) / Math.max(total, 0.01);
    if (diff <= 0.005) return 1;
    if (diff <= 0.03) return 0.7;
    if (doc.category === "meals" && charged > total && diff <= 0.2) return 0.45; // tip added on the card slip
    return 0;
  }
  // Foreign-currency purchase on a USD (or other) account: compare with the converted amount, allowing for bank FX markup.
  if (txn.currency === "USD" && doc.totalUsd != null) {
    const usd = Math.abs(Number(doc.totalUsd));
    const diff = Math.abs(charged - usd) / Math.max(usd, 0.01);
    if (diff <= 0.03) return 0.8;
    if (diff <= 0.06) return 0.55;
  }
  return 0;
}

/** Cards post 0–3 days after the purchase; bank transfers can be logged a day early. */
export function dateScore(txnDate: string, docDate: string | null): number {
  if (!docDate) return 0;
  const d = days(txnDate, docDate);
  if (d < -2 || d > MAX_DAYS) return 0;
  const table: Record<number, number> = { [-2]: 0.6, [-1]: 0.85, 0: 1, 1: 0.97, 2: 0.93, 3: 0.88, 4: 0.8, 5: 0.75 };
  return table[d] ?? 0.5;
}

/** Share of the vendor's name words that appear in the bank narration ("POS 4421 LAHORE GRILL HSE LHR"). */
export function nameScore(description: string, vendorName: string | null): number {
  const vendor = normalizeVendor(vendorName).split(" ").filter((w) => w.length >= 3);
  if (!vendor.length) return 0;
  const words = normalizeVendor(description).split(" ");
  const hit = (w: string) => words.some((d) => d === w || (d.length >= 4 && (w.startsWith(d) || d.startsWith(w.slice(0, 4)))));
  return vendor.filter(hit).length / vendor.length;
}

/** Bills and invoices are paid on their terms: anywhere from the issue date to a few weeks past due. */
export function termsDateScore(txnDate: string, docDate: string | null, dueDate: string | null): number {
  if (!docDate) return 0;
  const end = dueDate ?? new Date(Date.parse(docDate) + 30 * 86400_000).toISOString().slice(0, 10);
  if (days(txnDate, docDate) < -2 || days(txnDate, end) > 21) return 0;
  return days(txnDate, end) <= 3 ? 0.9 : 0.7;
}

export function score(txn: Pick<Txn, "amount" | "currency" | "txnDate" | "description">, doc: Doc): number {
  const a = amountScore(txn, doc);
  const d = doc.docType === "expense_receipt" ? dateScore(txn.txnDate, doc.docDate) : termsDateScore(txn.txnDate, doc.docDate, doc.dueDate);
  if (!a || !d) return 0;
  return Math.round((0.5 * a + 0.25 * d + 0.25 * nameScore(txn.description, doc.vendorName)) * 1000) / 1000;
}

async function applyPayment(txn: Txn, doc: Doc, actor: Actor) {
  if ((doc.docType === "vendor_bill" || doc.docType === "sales_invoice") && !doc.paidAt) {
    await markPaid(doc.id, { paidAt: txn.txnDate, paidAmount: txn.currency === doc.currency ? String(Math.abs(Number(txn.amount))) : undefined, paymentRef: `Bank: ${txn.description.slice(0, 80)}` }, actor);
  }
}

/**
 * Matches open transactions to documents. Pairs are ranked globally by score and assigned greedily, so each
 * transaction and each document is used once. A pair is auto-matched only if it scores ≥ 0.85 and clearly
 * beats the runner-up for both sides; otherwise the best candidate is only suggested for a tap to confirm.
 */
export async function runMatching(opts: { statementId?: string } = {}) {
  const db = await getDb();
  const txns = await db.query.bankTransactions.findMany({
    where: and(inArray(schema.bankTransactions.matchStatus, ["unmatched", "suggested"]), opts.statementId ? eq(schema.bankTransactions.statementId, opts.statementId) : undefined),
  });
  if (!txns.length) return { matched: 0, suggested: 0 };
  const dates = txns.map((t) => t.txnDate).sort();
  // Look back far enough for bills/invoices paid on 30–60 day terms.
  const from = new Date(Date.parse(dates[0]) - 90 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(dates[dates.length - 1]) + 2 * 86400_000).toISOString().slice(0, 10);
  const taken = db.select({ id: schema.bankTransactions.documentId }).from(schema.bankTransactions).where(and(eq(schema.bankTransactions.matchStatus, "matched"), isNotNull(schema.bankTransactions.documentId)));
  const docs = await db.query.documents.findMany({
    where: and(
      inArray(schema.documents.status, ["approved", "needs_review"]),
      inArray(schema.documents.docType, ["expense_receipt", "vendor_bill", "sales_invoice"]),
      gte(schema.documents.docDate, from),
      lte(schema.documents.docDate, to),
      notInArray(schema.documents.id, taken),
    ),
  });

  const pairs: { t: Txn; d: Doc; s: number }[] = [];
  for (const t of txns) {
    const out = Number(t.amount) < 0;
    for (const d of docs) {
      if (out === (d.docType === "sales_invoice")) continue; // money out ↔ expenses/bills, money in ↔ sales invoices
      const s = score(t, d);
      if (s >= SUGGEST) pairs.push({ t, d, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  const bestFor = (key: (p: (typeof pairs)[number]) => string) => {
    const m = new Map<string, number[]>();
    for (const p of pairs) m.set(key(p), [...(m.get(key(p)) ?? []), p.s]);
    return m;
  };
  const byTxn = bestFor((p) => p.t.id);
  const byDoc = bestFor((p) => p.d.id);
  const usedT = new Set<string>(), usedD = new Set<string>();
  let matched = 0, suggested = 0;
  const system: Actor = { type: "system", id: "bank-matcher" };

  for (const p of pairs) {
    if (usedT.has(p.t.id) || usedD.has(p.d.id)) continue;
    usedT.add(p.t.id);
    usedD.add(p.d.id);
    const runnerUp = Math.max(byTxn.get(p.t.id)![1] ?? 0, byDoc.get(p.d.id)![1] ?? 0);
    const auto = p.s >= AUTO_MATCH && p.s - runnerUp >= 0.1;
    await db
      .update(schema.bankTransactions)
      .set({ matchStatus: auto ? "matched" : "suggested", documentId: p.d.id, matchScore: p.s, matchedBy: auto ? "auto" : null })
      .where(eq(schema.bankTransactions.id, p.t.id));
    if (auto) {
      matched++;
      await audit(system, "bank_transaction", p.t.id, "auto_matched", { documentId: p.d.id, score: p.s });
      await applyPayment(p.t, p.d, system);
    } else suggested++;
  }
  // Earlier suggestions that no longer have a candidate go back to unmatched.
  for (const t of txns) {
    if (!usedT.has(t.id) && t.matchStatus === "suggested") {
      await db.update(schema.bankTransactions).set({ matchStatus: "unmatched", documentId: null, matchScore: null }).where(eq(schema.bankTransactions.id, t.id));
    }
  }
  return { matched, suggested };
}

/** Confirm a suggestion, or link a transaction to any document by hand. */
export async function confirmMatch(txnId: string, documentId: string, actor: Actor) {
  const db = await getDb();
  const t = await db.query.bankTransactions.findFirst({ where: eq(schema.bankTransactions.id, txnId) });
  const d = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
  if (!t || !d) throw new Error("Not found");
  const clash = await db.query.bankTransactions.findFirst({
    where: and(eq(schema.bankTransactions.documentId, documentId), eq(schema.bankTransactions.matchStatus, "matched"), ne(schema.bankTransactions.id, txnId)),
  });
  if (clash) throw new Error("That document is already matched to another transaction");
  await db.update(schema.bankTransactions).set({ matchStatus: "matched", documentId, matchedBy: actor.id ?? "user" }).where(eq(schema.bankTransactions.id, txnId));
  await audit(actor, "bank_transaction", txnId, "matched", { documentId });
  await applyPayment(t, d, actor);
}

export async function setTxnStatus(txnId: string, status: "unmatched" | "ignored", actor: Actor) {
  const db = await getDb();
  await db.update(schema.bankTransactions).set({ matchStatus: status, documentId: null, matchScore: null, matchedBy: null }).where(eq(schema.bankTransactions.id, txnId));
  await audit(actor, "bank_transaction", txnId, status === "ignored" ? "ignored" : "unmatched");
}

/** Both directions of "something's missing". */
export async function reconciliationGaps() {
  const db = await getDb();
  const t = schema.bankTransactions;
  const missingReceipts = await db.query.bankTransactions.findMany({
    where: and(inArray(t.matchStatus, ["unmatched", "suggested"]), sql`${t.amount} < 0`),
    orderBy: (x, { desc }) => desc(x.txnDate),
    limit: 300,
  });
  // Card/bank-paid documents inside an imported statement period that no transaction accounts for.
  const periods = await db.select({ start: schema.statements.periodStart, end: schema.statements.periodEnd }).from(schema.statements);
  const inPeriod = periods
    .filter((p) => p.start && p.end)
    .map((p) => sql`(${schema.documents.docDate} between ${p.start} and ${p.end})`);
  const notOnStatement = inPeriod.length
    ? await db.query.documents.findMany({
        where: and(
          eq(schema.documents.status, "approved"),
          inArray(schema.documents.paymentMethod, ["card", "bank_transfer"]),
          inArray(schema.documents.docType, ["expense_receipt", "vendor_bill"]),
          sql`(${sql.join(inPeriod, sql` or `)})`,
          notInArray(schema.documents.id, db.select({ id: t.documentId }).from(t).where(and(eq(t.matchStatus, "matched"), isNotNull(t.documentId)))),
        ),
        limit: 300,
      })
    : [];
  return { missingReceipts, notOnStatement };
}
