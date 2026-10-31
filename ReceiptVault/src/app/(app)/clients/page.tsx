import Link from "next/link";
import { asc, and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { money } from "@/components/format";
import { AddClient } from "@/components/Phase2Client";

export default async function ClientsPage() {
  const user = await pageUser();
  const db = await getDb();
  const d = schema.documents;
  const clients = await db.query.clients.findMany({ orderBy: asc(schema.clients.name) });
  const unbilled = await db
    .select({ clientId: d.clientId, n: sql<number>`count(*)::int`, usd: sql<number>`coalesce(sum(${d.totalUsd}),0)::float` })
    .from(d)
    .where(and(eq(d.status, "approved"), eq(d.isBillable, true), isNull(d.rebilledAt)))
    .groupBy(d.clientId);
  const by = Object.fromEntries(unbilled.map((u) => [u.clientId ?? "none", u]));
  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <h1 className="text-xl font-semibold">Clients</h1>
      <p className="text-sm muted">Billable expenses are attached to a client automatically when the receipt mentions the client's name or code, or when the vendor has a client rule.</p>
      <div className="card divide-y line px-4">
        {clients.map((c) => (
          <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center justify-between py-3">
            <div>
              <div className="font-medium">{c.name}</div>
              <div className="text-xs muted">{[c.code, c.email].filter(Boolean).join(" · ") || "—"}</div>
            </div>
            <div className="text-right text-sm">
              <div className="font-semibold tabular-nums">{money(by[c.id]?.usd ?? 0)}</div>
              <div className="text-xs muted">{by[c.id]?.n ?? 0} to re-invoice</div>
            </div>
          </Link>
        ))}
        {by.none && (
          <Link href="/documents?status=approved" className="flex items-center justify-between py-3 text-sm">
            <span className="text-amber-600">Billable but no client yet</span>
            <span>{by.none.n} · {money(by.none.usd)}</span>
          </Link>
        )}
        {!clients.length && <p className="py-6 text-center text-sm muted">No clients yet.</p>}
      </div>
      {user.role === "owner" && <div className="card p-4"><AddClient /></div>}
    </div>
  );
}
