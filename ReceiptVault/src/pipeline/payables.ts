import { and, asc, eq, inArray, isNull, isNotNull, lte, or, lt } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/db";
import { audit, type Actor } from "@/lib/audit";
import { syncLedger } from "./ledger";
import { emit } from "./events";

const d = schema.documents;

/** Unpaid vendor bills (payables) or unpaid sales invoices (receivables), soonest due first. */
export async function listOpen(kind: "payable" | "receivable") {
  const db = await getDb();
  return db.query.documents.findMany({
    where: and(
      eq(d.docType, kind === "payable" ? "vendor_bill" : "sales_invoice"),
      inArray(d.status, ["approved", "needs_review"]),
      isNull(d.paidAt),
    ),
    orderBy: [asc(d.dueDate), asc(d.docDate)],
    limit: 200,
  });
}

export async function listRecentlyPaid(kind: "payable" | "receivable") {
  const db = await getDb();
  return db.query.documents.findMany({
    where: and(eq(d.docType, kind === "payable" ? "vendor_bill" : "sales_invoice"), isNotNull(d.paidAt)),
    orderBy: (t, { desc }) => desc(t.paidAt),
    limit: 20,
  });
}

export const PaymentInput = z.object({
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paidAmount: z.union([z.number(), z.string().regex(/^\d+(\.\d+)?$/)]).transform(String).optional(),
  paymentRef: z.string().max(200).optional(),
});

export async function markPaid(id: string, input: z.infer<typeof PaymentInput>, actor: Actor) {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(d.id, id) });
  if (!doc) throw new Error("Document not found");
  if (doc.docType !== "vendor_bill" && doc.docType !== "sales_invoice") throw new Error("Only bills and invoices can be marked paid");
  await db
    .update(d)
    .set({ paidAt: input.paidAt, paidAmount: input.paidAmount ?? doc.total, paymentRef: input.paymentRef ?? null, updatedAt: new Date() })
    .where(eq(d.id, id));
  await audit(actor, "document", id, "marked_paid", { paidAt: input.paidAt, paidAmount: input.paidAmount ?? doc.total, ref: input.paymentRef ?? null });
  await syncLedger(id, actor);
  await emit(doc.docType === "vendor_bill" ? "bill.paid" : "invoice.paid", { id, vendor: doc.vendorName, amount: input.paidAmount ?? doc.total, currency: doc.currency, paidAt: input.paidAt });
}

export async function markUnpaid(id: string, actor: Actor) {
  const db = await getDb();
  await db.update(d).set({ paidAt: null, paidAmount: null, paymentRef: null, updatedAt: new Date() }).where(eq(d.id, id));
  await audit(actor, "document", id, "marked_unpaid");
  await syncLedger(id, actor);
}

/** Bills that need a reminder today: unpaid, due within `daysBefore` (or overdue), not reminded yet today. */
export async function billsNeedingReminder(today: string, daysBefore: number) {
  const db = await getDb();
  const horizon = new Date(Date.parse(today) + daysBefore * 86400_000).toISOString().slice(0, 10);
  return db.query.documents.findMany({
    where: and(
      eq(d.docType, "vendor_bill"),
      inArray(d.status, ["approved", "needs_review"]),
      isNull(d.paidAt),
      isNotNull(d.dueDate),
      lte(d.dueDate, horizon),
      or(isNull(d.remindedAt), lt(d.remindedAt, new Date(`${today}T00:00:00Z`))),
    ),
    orderBy: asc(d.dueDate),
  });
}
