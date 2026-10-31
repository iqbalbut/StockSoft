import Link from "next/link";
import { desc, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { money } from "@/components/format";

export default async function InvoicesPage() {
  const user = await pageUser();
  const db = await getDb();
  const invoices = await db.query.invoices.findMany({ orderBy: [desc(schema.invoices.issueDate), desc(schema.invoices.createdAt)], limit: 200 });
  const clientIds = [...new Set(invoices.map((i) => i.clientId))];
  const clients = clientIds.length ? await db.query.clients.findMany({ where: inArray(schema.clients.id, clientIds) }) : [];
  const docIds = invoices.map((i) => i.documentId).filter((x): x is string => !!x);
  const docs = docIds.length ? await db.query.documents.findMany({ columns: { id: true, paidAt: true }, where: inArray(schema.documents.id, docIds) }) : [];
  const name = new Map(clients.map((c) => [c.id, c.name]));
  const paid = new Map(docs.map((d) => [d.id, d.paidAt]));
  const today = new Date().toISOString().slice(0, 10);
  const state = (i: (typeof invoices)[number]) =>
    i.status === "draft" ? ["Draft", "bg-slate-500/15 muted"] : i.status === "void" ? ["Void", "bg-rose-500/15 text-rose-500"] : paid.get(i.documentId!) ? ["Paid", "bg-emerald-500/15 text-emerald-600"] : i.dueDate < today ? ["Overdue", "bg-rose-500/15 text-rose-500"] : [i.sentAt ? "Sent" : "Issued", "bg-sky-500/15 text-sky-600"];
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Invoices</h1>
        {user.role === "owner" && <Link href="/invoices/new" className="btn btn-primary">New invoice</Link>}
      </div>
      <div className="card divide-y line px-4">
        {invoices.map((i) => {
          const [label, cls] = state(i);
          return (
            <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between gap-2 py-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{i.number ?? "Draft"} · {name.get(i.clientId)}</div>
                <div className="text-xs muted">Issued {i.issueDate} · due {i.dueDate}</div>
              </div>
              <div className="shrink-0 text-right">
                <div className="font-semibold tabular-nums">{money(i.total, i.currency)}</div>
                <span className={`chip ${cls}`}>{label}</span>
              </div>
            </Link>
          );
        })}
        {!invoices.length && <p className="py-8 text-center text-sm muted">No invoices yet.</p>}
      </div>
      <p className="text-xs muted">Payments are recorded under Bills → Invoices to collect, or automatically when a bank statement shows the money arriving.</p>
    </div>
  );
}
