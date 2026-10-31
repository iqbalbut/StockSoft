import Link from "next/link";
import { listDocuments, statusCounts } from "@/pipeline/queries";
import { DocRow } from "@/components/DocRow";
import { STATUS_LABEL } from "@/components/format";

const TABS = [
  { key: "", label: "All" },
  { key: "approved", label: "Approved" },
  { key: "needs_review,duplicate", label: "Review" },
  { key: "queued,processing", label: "Processing" },
  { key: "failed", label: STATUS_LABEL.failed },
  { key: "rejected", label: STATUS_LABEL.rejected },
];

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0));
  const statuses = sp.status?.split(",").filter(Boolean);
  const [docs, counts] = await Promise.all([listDocuments({ statuses, q: sp.q, limit: 50, offset: page * 50 }), statusCounts()]);
  const qs = (o: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ status: sp.status, q: sp.q, ...o })) if (v) p.set(k, String(v));
    return `?${p}`;
  };
  return (
    <div className="space-y-3">
      <h1 className="text-xl font-semibold">Records</h1>
      <form className="flex gap-2">
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <input className="input" name="q" defaultValue={sp.q} placeholder="Search vendor, file name or invoice #" />
        <button className="btn btn-ghost">Search</button>
      </form>
      <div className="flex gap-1 overflow-x-auto pb-1 text-sm">
        {TABS.map((t) => {
          const n = t.key ? t.key.split(",").reduce((a, s) => a + (counts[s] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0);
          const active = (sp.status ?? "") === t.key;
          return (
            <Link key={t.key} href={qs({ status: t.key || undefined, page: undefined })} className={`shrink-0 rounded-full px-3 py-1.5 ${active ? "bg-brand-600 text-white" : "card"}`}>
              {t.label} <span className="opacity-70">{n}</span>
            </Link>
          );
        })}
      </div>
      <div className="card divide-y line px-4">
        {docs.map((d) => <DocRow key={d.id} doc={d} />)}
        {!docs.length && <p className="py-8 text-center text-sm muted">No documents.</p>}
      </div>
      <div className="flex justify-between text-sm">
        {page > 0 ? <Link className="underline" href={qs({ page: page - 1 })}>← Newer</Link> : <span />}
        {docs.length === 50 && <Link className="underline" href={qs({ page: page + 1 })}>Older →</Link>}
      </div>
    </div>
  );
}
