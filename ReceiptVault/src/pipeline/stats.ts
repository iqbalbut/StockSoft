import { and, eq, gte, inArray, lte, sql, desc, asc, ne, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";

const d = schema.documents;

export async function dashboardStats(year = new Date().getFullYear()) {
  const db = await getDb();
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  const expense = and(eq(d.isBusiness, true), ne(d.docType, "sales_invoice"), gte(d.docDate, from), lte(d.docDate, to));
  const usd = sql<number>`coalesce(sum(${d.totalUsd}), 0)::float`;

  const [claimed] = await db.select({ usd, n: sql<number>`count(*)::int` }).from(d).where(and(eq(d.status, "approved"), expense));
  const [unclaimed] = await db
    .select({ usd, n: sql<number>`count(*)::int` })
    .from(d)
    .where(inArray(d.status, ["queued", "processing", "needs_review", "duplicate", "failed"]));
  const [revenue] = await db
    .select({ usd })
    .from(d)
    .where(and(eq(d.status, "approved"), eq(d.docType, "sales_invoice"), gte(d.docDate, from), lte(d.docDate, to)));

  const byCategory = await db
    .select({ category: d.category, usd, n: sql<number>`count(*)::int` })
    .from(d)
    .where(and(eq(d.status, "approved"), expense))
    .groupBy(d.category)
    .orderBy(desc(usd));

  const month = sql<string>`to_char(${d.docDate}, 'YYYY-MM')`;
  const byMonth = await db
    .select({ month, usd })
    .from(d)
    .where(and(eq(d.status, "approved"), expense))
    .groupBy(month)
    .orderBy(asc(month));

  const byClient = await db
    .select({ client: d.clientRef, usd, n: sql<number>`count(*)::int` })
    .from(d)
    .where(and(eq(d.status, "approved"), eq(d.isBillable, true)))
    .groupBy(d.clientRef)
    .orderBy(desc(usd))
    .limit(8);

  const payables = await db.query.documents.findMany({
    where: and(eq(d.docType, "vendor_bill"), inArray(d.status, ["approved", "needs_review"]), isNull(d.paidAt)),
    orderBy: asc(d.dueDate),
    limit: 6,
  });

  const counts = Object.fromEntries(
    (await db.select({ status: d.status, n: sql<number>`count(*)::int` }).from(d).groupBy(d.status)).map((r) => [r.status, Number(r.n)]),
  ) as Record<string, number>;

  const recent = await db.query.documents.findMany({ orderBy: desc(d.createdAt), limit: 8 });
  const t = schema.bankTransactions;
  const [missing] = await db
    .select({ n: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(-${t.amount}),0)::float` })
    .from(t)
    .where(and(inArray(t.matchStatus, ["unmatched", "suggested"]), sql`${t.amount} < 0`));
  return { year, claimed, unclaimed, revenue: revenue.usd, byCategory, byMonth, byClient, payables, counts, recent, missingReceipts: missing.n };
}
