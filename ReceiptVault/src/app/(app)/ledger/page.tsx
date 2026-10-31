import Link from "next/link";
import { and, desc, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { money, categoryLabel } from "@/components/format";

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const year = Number((await searchParams).year) || new Date().getFullYear();
  const db = await getDb();
  const l = schema.ledgerEntries;
  const range = and(gte(l.entryDate, `${year}-01-01`), lte(l.entryDate, `${year}-12-31`));
  const totals = await db
    .select({ kind: l.kind, category: l.category, usd: sql<number>`coalesce(sum(${l.amountUsd}),0)::float`, n: sql<number>`count(*) filter (where ${l.reversalOf} is null and not ${l.reversed})::int` })
    .from(l)
    .where(range)
    .groupBy(l.kind, l.category)
    .orderBy(sql`3 desc`);
  const entries = await db.query.ledgerEntries.findMany({ where: range, orderBy: [desc(l.entryDate), desc(l.id)], limit: 200 });
  const revenue = totals.filter((t) => t.kind === "revenue").reduce((a, t) => a + t.usd, 0);
  const expenses = totals.filter((t) => t.kind === "expense").reduce((a, t) => a + t.usd, 0);
  const [{ missing }] = await db.select({ missing: sql<number>`count(*)::int` }).from(l).where(and(range, sql`${l.amountUsd} is null`));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Ledger {year}</h1>
        <div className="flex gap-3 text-sm">
          <Link className="underline" href={`/ledger?year=${year - 1}`}>{year - 1}</Link>
          <Link className="underline" href={`/ledger?year=${year + 1}`}>{year + 1}</Link>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3"><div className="text-xs muted">Revenue</div><div className="font-semibold tabular-nums">{money(revenue)}</div></div>
        <div className="card p-3"><div className="text-xs muted">Expenses</div><div className="font-semibold tabular-nums">{money(expenses)}</div></div>
        <div className="card p-3"><div className="text-xs muted">Net</div><div className="font-semibold tabular-nums">{money(revenue - expenses)}</div></div>
      </div>
      {missing > 0 && <p className="text-sm text-amber-600">{missing} entr{missing === 1 ? "y has" : "ies have"} no USD amount (no exchange rate); totals exclude them.</p>}
      <div className="card p-4">
        <h2 className="font-semibold">By category (USD)</h2>
        <ul className="mt-2 divide-y line text-sm">
          {totals.map((t) => (
            <li key={t.kind + t.category} className="flex justify-between py-1.5"><span>{categoryLabel(t.category)}</span><span className="tabular-nums">{money(t.usd)} · {t.n}</span></li>
          ))}
        </ul>
      </div>
      <div className="card overflow-x-auto p-4">
        <h2 className="font-semibold">Entries</h2>
        <table className="mt-2 w-full text-sm">
          <tbody className="divide-y line">
            {entries.map((e) => (
              <tr key={e.id} className={e.reversed ? "muted line-through decoration-1" : ""}>
                <td className="py-1.5 pr-2 whitespace-nowrap">{e.entryDate}</td>
                <td className="pr-2"><Link href={`/documents/${e.documentId}`} className="underline-offset-2 hover:underline">{e.description}</Link>{e.reversalOf ? " (reversal)" : ""}</td>
                <td className="hidden pr-2 sm:table-cell">{categoryLabel(e.category)}</td>
                <td className="text-right tabular-nums whitespace-nowrap">{money(e.amount, e.currency)}</td>
                <td className="hidden pl-2 text-right tabular-nums sm:table-cell">{e.amountUsd ? money(e.amountUsd) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <p className="py-6 text-center text-sm muted">No postings in {year}.</p>}
        <p className="mt-2 text-xs muted">Entries are never edited: a change reverses the old line (struck through) and posts a new one.</p>
      </div>
    </div>
  );
}
