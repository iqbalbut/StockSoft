import { and, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export async function listStatements() {
  const db = await getDb();
  const t = schema.bankTransactions;
  const stats = await db
    .select({
      statementId: t.statementId,
      n: sql<number>`count(*)::int`,
      matched: sql<number>`count(*) filter (where ${t.matchStatus} = 'matched')::int`,
      open: sql<number>`count(*) filter (where ${t.matchStatus} in ('unmatched','suggested') and ${t.amount} < 0)::int`,
    })
    .from(t)
    .groupBy(t.statementId);
  const by = new Map(stats.map((s) => [s.statementId, s]));
  const rows = await db.query.statements.findMany({ orderBy: desc(schema.statements.periodEnd) });
  return rows.map((s) => ({ ...s, ...(by.get(s.id) ?? { n: 0, matched: 0, open: 0 }) }));
}

/** Documents a user might link to a transaction by hand: same direction, within ±45 days. */
export async function linkCandidates(txnDate: string, outflow: boolean) {
  const db = await getDb();
  const d = schema.documents;
  const from = new Date(Date.parse(txnDate) - 45 * 86400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(txnDate) + 10 * 86400_000).toISOString().slice(0, 10);
  return db.query.documents.findMany({
    columns: { id: true, vendorName: true, docDate: true, total: true, currency: true },
    where: and(
      inArray(d.status, ["approved", "needs_review"]),
      outflow ? inArray(d.docType, ["expense_receipt", "vendor_bill"]) : eq(d.docType, "sales_invoice"),
      gte(d.docDate, from),
      lte(d.docDate, to),
    ),
    orderBy: desc(d.docDate),
    limit: 60,
  });
}
