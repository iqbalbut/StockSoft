import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { money, categoryLabel } from "@/components/format";
import { RebillSelected } from "@/components/Phase2Client";

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await pageUser();
  const { id } = await params;
  const db = await getDb();
  const client = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
  if (!client) notFound();
  const docs = await db.query.documents.findMany({
    where: and(eq(schema.documents.clientId, id), eq(schema.documents.isBillable, true), eq(schema.documents.status, "approved")),
    orderBy: desc(schema.documents.docDate),
  });
  const open = docs.filter((d) => !d.rebilledAt);
  const done = docs.filter((d) => d.rebilledAt);
  const totals = open.reduce<Record<string, number>>((a, d) => ((a[d.currency ?? "?"] = (a[d.currency ?? "?"] ?? 0) + Number(d.total ?? 0)), a), {});
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Link href="/clients" className="text-sm muted">← Clients</Link>
      <h1 className="text-xl font-semibold">{client.name}</h1>
      <div className="card p-4">
        <h2 className="font-semibold">To re-invoice</h2>
        <p className="text-sm muted">
          {open.length ? Object.entries(totals).map(([c, v]) => money(v, c)).join(" + ") : "Nothing outstanding."}
          {open.length > 0 && ` ≈ ${money(open.reduce((a, d) => a + Number(d.totalUsd ?? 0), 0))}`}
        </p>
        <ul className="mt-2 divide-y line text-sm">
          {open.map((d) => (
            <li key={d.id} className="flex justify-between gap-2 py-2">
              <Link href={`/documents/${d.id}`} className="min-w-0 truncate">{d.docDate} · {d.vendorName} · {categoryLabel(d.category)}</Link>
              <span className="shrink-0 tabular-nums">{money(d.total, d.currency)}</span>
            </li>
          ))}
        </ul>
        {user.role === "owner" && open.length > 0 && (
          <div className="mt-3 space-y-2">
            <Link href={`/invoices/new?clientId=${id}`} className="btn btn-primary w-full">Create invoice from these</Link>
            <RebillSelected clientId={id} ids={open.map((d) => d.id)} />
          </div>
        )}
        <p className="mt-2 text-xs muted">In the new invoice, tap “+ Billable expenses” (optionally with a markup). Issuing it marks these as re-invoiced. If you billed them outside ReceiptVault, use “Mark as re-invoiced”.</p>
      </div>
      {done.length > 0 && (
        <details className="card px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">Already re-invoiced ({done.length})</summary>
          <ul className="mt-2 divide-y line">
            {done.map((d) => (
              <li key={d.id} className="flex justify-between py-2"><span>{d.docDate} · {d.vendorName}</span><span>{money(d.total, d.currency)} · {d.rebilledAt}</span></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
