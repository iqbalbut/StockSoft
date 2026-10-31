import { and, eq, gte, lte, asc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { CATEGORIES, type Category } from "@/extraction/schema";

export type LedgerRow = typeof schema.ledgerEntries.$inferSelect & { doc: typeof schema.documents.$inferSelect };

/** Everything a year-end report needs, computed from the ledger (net of reversals). */
export async function yearData(year: number) {
  const db = await getDb();
  const settings = await getSettings();
  const l = schema.ledgerEntries;
  const entries = await db.query.ledgerEntries.findMany({
    where: and(gte(l.entryDate, `${year}-01-01`), lte(l.entryDate, `${year}-12-31`)),
    orderBy: [asc(l.entryDate), asc(l.id)],
  });
  const docIds = [...new Set(entries.map((e) => e.documentId))];
  const docs = docIds.length ? await db.query.documents.findMany({ where: inArray(schema.documents.id, docIds) }) : [];
  const docById = new Map(docs.map((d) => [d.id, d]));
  const clients = await db.query.clients.findMany();
  const clientName = new Map(clients.map((c) => [c.id, c.name]));
  const rows: LedgerRow[] = entries.map((e) => ({ ...e, doc: docById.get(e.documentId)! }));
  const live = rows.filter((r) => !r.reversed);

  const byCategory = new Map<string, { usd: number; n: number; missingUsd: number }>();
  let revenue = 0, missingUsd = 0;
  for (const r of rows) {
    const usd = r.amountUsd == null ? null : Number(r.amountUsd);
    if (usd == null) missingUsd++;
    if (r.kind === "revenue") revenue += usd ?? 0;
    else {
      const c = byCategory.get(r.category) ?? { usd: 0, n: 0, missingUsd: 0 };
      c.usd += usd ?? 0;
      if (!r.reversed) c.n++;
      if (usd == null) c.missingUsd++;
      byCategory.set(r.category, c);
    }
  }
  const categories = [...byCategory.entries()]
    .map(([category, v]) => {
      const meta = CATEGORIES[category as Category] ?? CATEGORIES.other;
      const deductible = category === "meals" ? v.usd * 0.5 : v.usd; // IRS 50% limit on business meals
      return { category, label: meta.label, scheduleC: meta.scheduleC, usd: round(v.usd), deductibleUsd: round(deductible), count: v.n, missingUsd: v.missingUsd };
    })
    .sort((a, b) => a.scheduleC.localeCompare(b.scheduleC, undefined, { numeric: true }));
  const expenses = round(categories.reduce((a, c) => a + c.usd, 0));
  const deductible = round(categories.reduce((a, c) => a + c.deductibleUsd, 0));

  const months = Array.from({ length: 12 }, (_, i) => ({ month: `${year}-${String(i + 1).padStart(2, "0")}`, expenses: 0, revenue: 0 }));
  for (const r of rows) {
    const m = months[Number(r.entryDate.slice(5, 7)) - 1];
    if (r.kind === "revenue") m.revenue += Number(r.amountUsd ?? 0);
    else m.expenses += Number(r.amountUsd ?? 0);
  }
  months.forEach((m) => ((m.expenses = round(m.expenses)), (m.revenue = round(m.revenue))));

  return {
    year,
    settings,
    rows,
    live,
    categories,
    months,
    totals: { revenue: round(revenue), expenses, deductible, net: round(revenue - deductible), missingUsd },
    clientName,
    generatedAt: new Date().toISOString(),
  };
}

export const round = (n: number) => Math.round(n * 100) / 100;
export type YearData = Awaited<ReturnType<typeof yearData>>;
