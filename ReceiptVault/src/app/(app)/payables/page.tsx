import Link from "next/link";
import { listOpen, listRecentlyPaid } from "@/pipeline/payables";
import { pageUser } from "@/lib/page-auth";
import { getSettings } from "@/lib/settings";
import { money, STATUS_LABEL } from "@/components/format";
import { MarkPaid } from "@/components/Phase2Client";

export default async function PayablesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await pageUser();
  const kind = (await searchParams).tab === "receivable" ? "receivable" : "payable";
  const [open, paid, settings] = await Promise.all([listOpen(kind), listRecentlyPaid(kind), getSettings()]);
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + settings.reminderDaysBefore * 86400_000).toISOString().slice(0, 10);
  const owner = user.role === "owner";
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold">Bills & invoices</h1>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1 text-sm dark:bg-white/5">
        <Link href="/payables" className={`rounded-lg py-2 text-center font-semibold ${kind === "payable" ? "bg-[var(--card)] shadow" : "muted"}`}>Bills to pay</Link>
        <Link href="/payables?tab=receivable" className={`rounded-lg py-2 text-center font-semibold ${kind === "receivable" ? "bg-[var(--card)] shadow" : "muted"}`}>Invoices to collect</Link>
      </div>
      <p className="text-xs muted">
        {settings.accountingBasis === "cash" ? "Cash basis: these post to the ledger on the day you mark them paid." : "Accrual basis: these posted to the ledger on their document date."} Reminders go out {settings.reminderDaysBefore} days before the due date.
      </p>
      <div className="card divide-y line px-4">
        {open.map((b) => {
          const overdue = b.dueDate != null && b.dueDate < today;
          const dueSoon = !overdue && b.dueDate != null && b.dueDate <= soon;
          return (
            <div key={b.id} className="flex flex-wrap items-center gap-2 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/documents/${b.id}`} className="block truncate font-medium">{b.vendorName ?? b.originalFilename}</Link>
                <div className="text-xs muted">
                  {b.docNumber ? `#${b.docNumber} · ` : ""}
                  <span className={overdue ? "font-semibold text-rose-500" : dueSoon ? "font-semibold text-amber-600" : ""}>{b.dueDate ? `due ${b.dueDate}${overdue ? " · overdue" : ""}` : "no due date"}</span>
                  {b.status !== "approved" && ` · ${STATUS_LABEL[b.status]}`}
                </div>
              </div>
              <div className="text-right font-semibold tabular-nums">{money(b.total, b.currency)}</div>
              {owner && <MarkPaid id={b.id} total={b.total} currency={b.currency} />}
            </div>
          );
        })}
        {!open.length && <p className="py-8 text-center text-sm muted">Nothing open. {kind === "payable" ? "Bills with a due date appear here automatically." : "Sales invoices appear here until they're paid."}</p>}
      </div>
      {paid.length > 0 && (
        <details className="card px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Recently paid ({paid.length})</summary>
          <ul className="mt-2 divide-y line text-sm">
            {paid.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2 py-2">
                <Link href={`/documents/${b.id}`} className="truncate">{b.vendorName}</Link>
                <span className="shrink-0 tabular-nums">{money(b.paidAmount ?? b.total, b.currency)} · {b.paidAt} {owner && <MarkPaid id={b.id} total={null} currency={null} paid />}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
