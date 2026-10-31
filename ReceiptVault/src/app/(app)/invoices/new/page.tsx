import { asc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { getSettings } from "@/lib/settings";
import { InvoiceEditor } from "@/components/Phase3Client";

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ clientId?: string }> }) {
  const user = await pageUser();
  if (user.role !== "owner") redirect("/invoices");
  const db = await getDb();
  const [clients, s] = await Promise.all([db.query.clients.findMany({ columns: { id: true, name: true }, orderBy: asc(schema.clients.name) }), getSettings()]);
  const today = new Date().toISOString().slice(0, 10);
  const due = new Date(Date.now() + s.invoiceDueDays * 86400_000).toISOString().slice(0, 10);
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold">New invoice</h1>
      {!clients.length ? (
        <p className="card p-4 text-sm">Add a client first (Clients).</p>
      ) : (
        <div className="card p-4">
          <InvoiceEditor
            clients={clients}
            dueDays={s.invoiceDueDays}
            initial={{ clientId: (await searchParams).clientId ?? "", currency: "USD", issueDate: today, dueDate: due, taxRate: 0, notes: "", lines: [{ description: "", quantity: 1, unitPrice: 0 }] }}
          />
        </div>
      )}
    </div>
  );
}
