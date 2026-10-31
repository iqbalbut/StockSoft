import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { linkCandidates } from "@/bank/queries";
import { money } from "@/components/format";
import { TxnActions } from "@/components/Phase3Client";

const STYLE: Record<string, string> = {
  matched: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  suggested: "bg-sky-500/15 text-sky-600 dark:text-sky-400",
  unmatched: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  ignored: "bg-slate-500/15 muted",
};

export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser();
  const { id } = await params;
  const db = await getDb();
  const st = await db.query.statements.findFirst({ where: eq(schema.statements.id, id) });
  if (!st) notFound();
  const txns = await db.query.bankTransactions.findMany({ where: eq(schema.bankTransactions.statementId, id), orderBy: asc(schema.bankTransactions.txnDate) });
  const docIds = txns.map((t) => t.documentId).filter((x): x is string => !!x);
  const docs = docIds.length ? await db.query.documents.findMany({ where: inArray(schema.documents.id, docIds) }) : [];
  const docBy = new Map(docs.map((d) => [d.id, d]));
  const owner = user.role === "owner";
  const open = txns.filter((t) => t.matchStatus === "unmatched" || t.matchStatus === "suggested");
  const cands = owner ? await Promise.all(open.map((t) => linkCandidates(t.txnDate, Number(t.amount) < 0))) : [];
  const candBy = new Map(open.map((t, i) => [t.id, cands[i] ?? []]));

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <Link href="/bank" className="text-sm muted">← Statements</Link>
      <h1 className="text-xl font-semibold">{st.name}</h1>
      <p className="text-sm muted">{st.currency}{st.accountLast4 ? ` ··${st.accountLast4}` : ""} · {st.periodStart} → {st.periodEnd} · {txns.filter((t) => t.matchStatus === "matched").length} of {txns.length} matched</p>
      <div className="card divide-y line px-4">
        {txns.map((t) => {
          const d = t.documentId ? docBy.get(t.documentId) : null;
          return (
            <div key={t.id} id={t.id} className="py-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.description}</div>
                  <div className="text-xs muted">{t.txnDate}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`font-semibold tabular-nums ${Number(t.amount) > 0 ? "text-emerald-600" : ""}`}>{money(t.amount, t.currency)}</div>
                  <span className={`chip ${STYLE[t.matchStatus]}`}>{t.matchStatus}{t.matchScore ? ` ${Math.round(t.matchScore * 100)}%` : ""}</span>
                </div>
              </div>
              {d && (
                <Link href={`/documents/${d.id}`} className="mt-1 block truncate text-xs underline-offset-2 hover:underline">
                  ↳ {d.vendorName} · {d.docDate} · {money(d.total, d.currency)}
                </Link>
              )}
              {owner && (
                <TxnActions
                  id={t.id}
                  status={t.matchStatus}
                  suggestion={t.matchStatus === "suggested" ? t.documentId : null}
                  candidates={(candBy.get(t.id) ?? []).map((c) => ({ id: c.id, label: `${c.docDate} · ${c.vendorName ?? "?"} · ${Number(c.total ?? 0).toFixed(2)} ${c.currency ?? ""}` }))}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
