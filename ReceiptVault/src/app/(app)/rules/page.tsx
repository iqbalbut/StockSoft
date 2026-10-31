import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { pageUser } from "@/lib/page-auth";
import { listVendorRules } from "@/pipeline/rules";
import { RuleRow } from "@/components/Phase2Client";

export default async function RulesPage() {
  const user = await pageUser();
  const db = await getDb();
  const [rules, clients] = await Promise.all([listVendorRules(), db.query.clients.findMany({ columns: { id: true, name: true }, orderBy: asc(schema.clients.name) })]);
  return (
    <div className="mx-auto max-w-3xl space-y-3">
      <h1 className="text-xl font-semibold">Vendor rules</h1>
      <p className="text-sm muted">
        A rule overrides the AI for every future document from that vendor (and counts as 100% confident). Rules are also learned automatically when you correct a category or business/personal flag in review. Saving a rule applies it to that vendor's documents still waiting in review.
      </p>
      <div className="card divide-y line px-4">
        {rules.map((r) => <RuleRow key={r.id} rule={{ ...r, documents: Number(r.documents) }} clients={clients} readOnly={user.role !== "owner"} />)}
        {!rules.length && <p className="py-8 text-center text-sm muted">Vendors appear here after their first document is read.</p>}
      </div>
    </div>
  );
}
