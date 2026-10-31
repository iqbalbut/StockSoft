import Link from "next/link";
import { dashboardStats } from "@/pipeline/stats";
import { money, categoryLabel } from "@/components/format";
import { DocRow } from "@/components/DocRow";

function Bar({ label, value, max, sub }: { label: string; value: number; max: number; sub?: string }) {
  return (
    <div>
      <div className="flex justify-between gap-2 text-sm">
        <span className="truncate">{label}</span>
        <span className="tabular-nums font-medium">{money(value)}{sub && <span className="muted font-normal"> · {sub}</span>}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${max ? Math.max(2, (value / max) * 100) : 0}%` }} />
      </div>
    </div>
  );
}

export default async function Dashboard() {
  const s = await dashboardStats();
  const review = (s.counts.needs_review ?? 0) + (s.counts.duplicate ?? 0);
  const inFlight = (s.counts.queued ?? 0) + (s.counts.processing ?? 0);
  const catMax = Math.max(0, ...s.byCategory.map((c) => c.usd));
  const monthMax = Math.max(0, ...s.byMonth.map((m) => m.usd));

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm muted">AiNetworks LLC · {s.year}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        </div>
        <Link href="/settings" className="btn btn-ghost md:hidden" aria-label="Settings">⚙︎</Link>
      </div>

      <nav className="-mx-4 flex gap-2 overflow-x-auto px-4 text-sm md:hidden">
        {[["/payables", "Bills"], ["/clients", "Clients"], ["/rules", "Rules"], ["/ledger", "Ledger"], ["/documents", "Records"]].map(([href, label]) => (
          <Link key={href} href={href} className="card shrink-0 px-4 py-2 font-medium">{label}</Link>
        ))}
      </nav>

      {review > 0 && (
        <Link href="/review" className="card flex items-center justify-between border-amber-500/40 bg-amber-500/10 p-4">
          <div>
            <div className="font-semibold">{review} document{review === 1 ? "" : "s"} need a quick look</div>
            <div className="text-sm muted">Swipe through them in about {Math.max(1, Math.round(review * 0.15))} min</div>
          </div>
          <span className="btn btn-primary">Review</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card p-4"><div className="text-xs muted">Claimed expenses (USD)</div><div className="mt-1 text-xl font-semibold tabular-nums">{money(s.claimed.usd)}</div><div className="text-xs muted">{s.claimed.n} approved</div></div>
        <div className="card p-4"><div className="text-xs muted">Not yet claimed</div><div className="mt-1 text-xl font-semibold tabular-nums">{money(s.unclaimed.usd)}</div><div className="text-xs muted">{s.unclaimed.n} in pipeline</div></div>
        <div className="card p-4"><div className="text-xs muted">Invoiced revenue</div><div className="mt-1 text-xl font-semibold tabular-nums">{money(s.revenue)}</div><div className="text-xs muted">sales invoices</div></div>
        <div className="card p-4"><div className="text-xs muted">Processing now</div><div className="mt-1 text-xl font-semibold tabular-nums">{inFlight}</div><div className="text-xs muted">{s.counts.failed ?? 0} failed</div></div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Spend by category</h2>
          {s.byCategory.length ? s.byCategory.slice(0, 8).map((c) => <Bar key={c.category ?? "none"} label={categoryLabel(c.category)} value={c.usd} max={catMax} sub={`${c.n}`} />) : <p className="text-sm muted">No approved expenses yet.</p>}
        </section>
        <section className="card space-y-3 p-4">
          <h2 className="font-semibold">Spend by month</h2>
          {s.byMonth.length ? s.byMonth.map((m) => <Bar key={m.month} label={m.month} value={m.usd} max={monthMax} />) : <p className="text-sm muted">No approved expenses yet.</p>}
        </section>
        <section className="card p-4">
          <div className="flex items-center justify-between"><h2 className="font-semibold">Bills due</h2><Link href="/payables" className="text-sm muted underline">All</Link></div>
          {s.payables.length ? (
            <ul className="mt-2 divide-y line text-sm">
              {s.payables.map((p) => (
                <li key={p.id} className="flex justify-between py-2">
                  <Link href={`/documents/${p.id}`} className="truncate">{p.vendorName}</Link>
                  <span className="tabular-nums">{money(p.total, p.currency)} · due {p.dueDate}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm muted">No upcoming bills.</p>}
        </section>
        <section className="card p-4">
          <h2 className="font-semibold">Billable by client</h2>
          {s.byClient.length ? (
            <ul className="mt-2 divide-y line text-sm">
              {s.byClient.map((c) => (
                <li key={c.client ?? "none"} className="flex justify-between py-2"><span>{c.client ?? "Unassigned"}</span><span className="tabular-nums">{money(c.usd)} · {c.n}</span></li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm muted">No billable expenses yet.</p>}
        </section>
      </div>

      <section className="card p-4">
        <div className="flex items-center justify-between"><h2 className="font-semibold">Latest documents</h2><Link href="/documents" className="text-sm muted underline">All</Link></div>
        <div className="divide-y line">{s.recent.map((d) => <DocRow key={d.id} doc={d} />)}</div>
        {!s.recent.length && <p className="py-6 text-center text-sm muted">Nothing yet. <Link className="underline" href="/capture">Snap your first receipt</Link>.</p>}
      </section>
    </div>
  );
}
