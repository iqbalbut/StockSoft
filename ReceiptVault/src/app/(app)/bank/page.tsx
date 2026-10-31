import Link from "next/link";
import { pageUser } from "@/lib/page-auth";
import { listStatements } from "@/bank/queries";
import { reconciliationGaps } from "@/bank/match";
import { money } from "@/components/format";
import { StatementImport, RematchButton } from "@/components/Phase3Client";

export default async function BankPage() {
  const user = await pageUser();
  const owner = user.role === "owner";
  const [statements, gaps] = await Promise.all([listStatements(), reconciliationGaps()]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-semibold">Bank & card statements</h1>
      {owner && <section className="card p-4"><h2 className="mb-2 font-semibold">Import a statement</h2><StatementImport /></section>}

      <section className="grid gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <div className="card p-4">
          <h2 className="font-semibold">Charges without a receipt <span className="muted">({gaps.missingReceipts.length})</span></h2>
          <p className="text-xs muted">Find the receipt and snap it, or mark “No receipt needed” (bank fees, transfers, ATM).</p>
          <ul className="mt-2 divide-y line text-sm">
            {gaps.missingReceipts.slice(0, 12).map((t) => (
              <li key={t.id} className="flex justify-between gap-2 py-1.5">
                <Link href={`/bank/${t.statementId}#${t.id}`} className="min-w-0 truncate">{t.txnDate} · {t.description}</Link>
                <span className="shrink-0 tabular-nums">{money(t.amount, t.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="card p-4">
          <h2 className="font-semibold">Receipts not on any statement <span className="muted">({gaps.notOnStatement.length})</span></h2>
          <p className="text-xs muted">Paid by card or transfer within an imported period, but no transaction matches. Wrong amount or date, a different card, or a missing statement.</p>
          <ul className="mt-2 divide-y line text-sm">
            {gaps.notOnStatement.slice(0, 12).map((d) => (
              <li key={d.id} className="flex justify-between gap-2 py-1.5">
                <Link href={`/documents/${d.id}`} className="min-w-0 truncate">{d.docDate} · {d.vendorName}</Link>
                <span className="shrink-0 tabular-nums">{money(d.total, d.currency)}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">Statements</h2>{owner && statements.length > 0 && <RematchButton />}</div>
        <ul className="mt-2 divide-y line text-sm">
          {statements.map((s) => (
            <li key={s.id}>
              <Link href={`/bank/${s.id}`} className="flex items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="text-xs muted">{s.currency}{s.accountLast4 ? ` ··${s.accountLast4}` : ""} · {s.sourceFormat.toUpperCase()} · {s.periodStart} → {s.periodEnd}</span>
                </span>
                <span className="shrink-0 text-right text-xs">
                  <span className="block font-semibold">{s.matched}/{s.n} matched</span>
                  {s.open > 0 && <span className="text-amber-600">{s.open} open</span>}
                </span>
              </Link>
            </li>
          ))}
          {!statements.length && <li className="py-6 text-center muted">No statements yet. Export last month's CSV from your bank or card site and import it above.</li>}
        </ul>
      </section>
    </div>
  );
}
