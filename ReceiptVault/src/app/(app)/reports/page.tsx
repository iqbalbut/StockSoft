import { yearData } from "@/reports/data";
import { money } from "@/components/format";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const year = Number((await searchParams).year) || new Date().getFullYear();
  const y = await yearData(year);
  const currencies = [...new Set(y.rows.map((r) => r.currency))];
  const dl = (href: string, label: string, hint: string) => (
    <a href={href} className="card flex items-center justify-between gap-3 p-3 hover:border-brand-500">
      <span><span className="block font-medium">{label}</span><span className="text-xs muted">{hint}</span></span>
      <span className="text-brand-600">↓</span>
    </a>
  );
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Reports & exports</h1>
        <form className="flex gap-2">
          <select name="year" defaultValue={year} className="input !w-auto">
            {Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i).map((v) => <option key={v}>{v}</option>)}
          </select>
          <button className="btn btn-ghost">Show</button>
        </form>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3"><div className="text-xs muted">Revenue</div><div className="font-semibold">{money(y.totals.revenue)}</div></div>
        <div className="card p-3"><div className="text-xs muted">Expenses</div><div className="font-semibold">{money(y.totals.expenses)}</div></div>
        <div className="card p-3"><div className="text-xs muted">Deductible</div><div className="font-semibold">{money(y.totals.deductible)}</div></div>
        <div className="card p-3"><div className="text-xs muted">Net profit</div><div className="font-semibold">{money(y.totals.net)}</div></div>
      </div>
      {y.totals.missingUsd > 0 && <p className="text-sm text-amber-600">{y.totals.missingUsd} ledger line(s) have no USD rate and are left out of USD totals.</p>}

      <section className="space-y-2">
        <h2 className="font-semibold">Year-end tax package</h2>
        {dl(`/api/reports/tax-package?year=${year}`, `tax-package-${year}.zip`, "Summary PDF (Schedule C totals + every receipt), Excel with receipt links, CSV, Xero/QuickBooks files, original receipts")}
        <p className="text-xs muted">Building it can take a minute for a few hundred receipts.</p>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">Exports</h2>
        {dl(`/api/exports/ledger.xlsx?year=${year}`, "Excel workbook", "Summary, Schedule C, ledger, monthly")}
        {dl(`/api/exports/ledger.csv?year=${year}`, "Ledger CSV", "Every posting incl. reversals, original currency + USD")}
        {dl(`/api/exports/xero-bills.csv?year=${year}`, "Xero: bills", "Business → Bills to pay → Import")}
        {dl(`/api/exports/xero-sales.csv?year=${year}`, "Xero: sales invoices", "Business → Invoices → Import")}
        {dl(`/api/exports/qbo-invoices.csv?year=${year}`, "QuickBooks Online: invoices", "Sales → Invoices → Import invoices")}
        {currencies.map((c) => dl(`/api/exports/qbo-bank-${c}.csv?year=${year}`, `QuickBooks Online: ${c} transactions`, "Banking → Upload transactions (3-column)"))}
      </section>

      <section className="card p-4">
        <h2 className="font-semibold">Schedule C preview</h2>
        <ul className="mt-2 divide-y line text-sm">
          {y.categories.map((c) => (
            <li key={c.category} className="flex justify-between gap-2 py-1.5"><span className="min-w-0 truncate">{c.scheduleC} · <span className="muted">{c.label}</span></span><span className="shrink-0 tabular-nums">{money(c.deductibleUsd)}</span></li>
          ))}
          {!y.categories.length && <li className="py-4 text-center muted">No postings in {year}.</li>}
        </ul>
        <p className="mt-2 text-xs muted">Meals shown at the 50% deductible amount. Your tax preparer decides the final treatment (e.g. Form 1065/1120 instead of Schedule C, Sec. 179 for equipment).</p>
      </section>
    </div>
  );
}
