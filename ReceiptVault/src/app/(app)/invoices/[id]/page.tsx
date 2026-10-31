import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { getSettings } from "@/lib/settings";
import { loadInvoice } from "@/invoices/invoices";
import { money } from "@/components/format";
import { InvoiceEditor, InvoiceActions } from "@/components/Phase3Client";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser();
  const r = await loadInvoice((await params).id);
  if (!r) notFound();
  const { inv, lines, client } = r;
  const owner = user.role === "owner";
  const db = await getDb();
  const doc = inv.documentId ? await db.query.documents.findFirst({ where: eq(schema.documents.id, inv.documentId) }) : null;
  if (inv.status === "draft" && owner) {
    const [clients, s] = await Promise.all([db.query.clients.findMany({ columns: { id: true, name: true }, orderBy: asc(schema.clients.name) }), getSettings()]);
    return (
      <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-[1fr_280px]">
        <div className="card p-4">
          <h1 className="mb-3 text-xl font-semibold">Draft invoice · {client.name}</h1>
          <InvoiceEditor
            clients={clients}
            dueDays={s.invoiceDueDays}
            initial={{ id: inv.id, clientId: inv.clientId, currency: inv.currency, issueDate: inv.issueDate, dueDate: inv.dueDate, taxRate: Number(inv.taxRate), notes: inv.notes ?? "", lines: lines.map((l) => ({ description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), sourceDocumentId: l.sourceDocumentId })) }}
          />
        </div>
        <div className="card h-fit p-4"><InvoiceActions id={inv.id} status={inv.status} clientEmail={client.email} sentTo={inv.sentTo} /></div>
      </div>
    );
  }
  return (
    <div className="mx-auto grid max-w-4xl gap-4 md:grid-cols-[1fr_280px]">
      <div className="card p-4 text-sm">
        <Link href="/invoices" className="muted">← Invoices</Link>
        <h1 className="mt-1 text-xl font-semibold">{inv.number ?? "Draft"} · {client.name}</h1>
        <p className="muted">Issued {inv.issueDate} · due {inv.dueDate} · {inv.status}{doc?.paidAt ? ` · paid ${doc.paidAt}` : ""}</p>
        <ul className="mt-3 divide-y line">
          {lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-2 py-2"><span>{Number(l.quantity) !== 1 ? `${Number(l.quantity)} × ` : ""}{l.description}</span><span className="tabular-nums">{Number(l.amount).toFixed(2)}</span></li>
          ))}
        </ul>
        <div className="mt-2 text-right">
          {Number(inv.tax) > 0 && <div className="muted">Tax {Number(inv.taxRate)}%: {Number(inv.tax).toFixed(2)}</div>}
          <div className="text-lg font-semibold">{money(inv.total, inv.currency)}</div>
        </div>
        {doc && <Link href={`/documents/${doc.id}`} className="mt-3 inline-block underline">Accounting record & payment</Link>}
      </div>
      <div className="card h-fit p-4"><InvoiceActions id={inv.id} status={inv.status} clientEmail={client.email} sentTo={inv.sentTo} /></div>
    </div>
  );
}
