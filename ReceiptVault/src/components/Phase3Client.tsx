"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/extraction/schema";
import type { AppSettings } from "@/lib/settings";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.issues?.[0]?.message ?? data.error ?? "Failed");
  return data;
}

// ---------------- Bank ----------------

export function StatementImport() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [last4, setLast4] = useState("");
  const [order, setOrder] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    setMsg("");
    const form = new FormData();
    form.append("file", file);
    form.append("currency", currency);
    form.append("last4", last4);
    if (order) form.append("dayFirst", order);
    const res = await fetch("/api/bank/import", { method: "POST", body: form });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setMsg(data.error);
    setMsg(`${data.imported} transactions imported${data.duplicates ? ` (${data.duplicates} already known)` : ""}${data.skipped ? `, ${data.skipped} lines skipped` : ""}. ${data.matched} matched automatically, ${data.suggested} suggested.${data.notes ? ` Note: ${data.notes}` : ""}`);
    setFile(null);
    router.refresh();
  }
  return (
    <form onSubmit={submit} className="space-y-2 text-sm">
      <input type="file" accept=".csv,text/csv,application/pdf,image/*" className="input min-w-0" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 [&>*]:min-w-0">
        <label><span className="text-xs muted">Account currency</span>
          <select className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {["USD", "PKR", "AED", "GBP", "EUR"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label><span className="text-xs muted">Card/account last 4</span>
          <input className="input" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
        </label>
        <label><span className="text-xs muted">Dates like 03/04</span>
          <select className="input" value={order} onChange={(e) => setOrder(e.target.value)}>
            <option value="">Auto</option>
            <option value="1">Day first</option>
            <option value="0">Month first (US)</option>
          </select>
        </label>
      </div>
      <button className="btn btn-primary w-full" disabled={!file || busy}>{busy ? "Reading statement…" : "Import and match"}</button>
      {msg && <p className="muted">{msg}</p>}
      <p className="text-xs muted">CSV is exact and free; PDFs and photos are read by Claude (a minute or two, needs an API key). Re-importing an overlapping period skips transactions already imported.</p>
    </form>
  );
}

export function TxnActions({ id, status, suggestion, candidates }: { id: string; status: string; suggestion?: string | null; candidates?: { id: string; label: string }[] }) {
  const router = useRouter();
  const [pick, setPick] = useState("");
  const [err, setErr] = useState("");
  const act = async (body: unknown) => {
    try {
      await call(`/api/bank/transactions/${id}`, "POST", body);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
      {status === "suggested" && suggestion && <button className="btn btn-success !min-h-8 !py-1 text-xs" onClick={() => act({ action: "confirm", documentId: suggestion })}>Confirm match</button>}
      {(status === "matched" || status === "suggested") && <button className="underline muted" onClick={() => act({ action: "unmatch" })}>Unmatch</button>}
      {status !== "ignored" && status !== "matched" && <button className="underline muted" onClick={() => act({ action: "ignore" })}>No receipt needed</button>}
      {status === "ignored" && <button className="underline muted" onClick={() => act({ action: "unmatch" })}>Undo ignore</button>}
      {status !== "matched" && candidates && candidates.length > 0 && (
        <span className="flex items-center gap-1">
          <select className="input !py-1 text-xs" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Link to…</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
          {pick && <button className="btn btn-ghost !min-h-8 !py-1 text-xs" onClick={() => act({ action: "confirm", documentId: pick })}>Link</button>}
        </span>
      )}
      {err && <span className="text-rose-500">{err}</span>}
    </div>
  );
}

export function RematchButton() {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  return (
    <span className="flex items-center gap-2 text-sm">
      <button className="btn btn-ghost" onClick={async () => {
        const r = await call("/api/bank/match", "POST");
        setMsg(`${r.matched} matched, ${r.suggested} suggested`);
        router.refresh();
      }}>Re-run matching</button>
      <span className="muted">{msg}</span>
    </span>
  );
}

// ---------------- Invoices ----------------

type LineDraft = { description: string; quantity: number; unitPrice: number; sourceDocumentId?: string | null };
type InvoiceDraft = { id?: string; clientId: string; currency: string; issueDate: string; dueDate: string; taxRate: number; notes: string; lines: LineDraft[] };

export function InvoiceEditor({ initial, clients, dueDays }: { initial: InvoiceDraft; clients: { id: string; name: string }[]; dueDays: number }) {
  const router = useRouter();
  const [inv, setInv] = useState(initial);
  const [markup, setMarkup] = useState(0);
  const [msg, setMsg] = useState("");
  const set = (p: Partial<InvoiceDraft>) => setInv((x) => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<LineDraft>) => set({ lines: inv.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const subtotal = inv.lines.reduce((a, l) => a + Math.round(l.quantity * l.unitPrice * 100) / 100, 0);
  const tax = Math.round(subtotal * inv.taxRate) / 100;

  useEffect(() => {
    if (!inv.id && inv.issueDate) set({ dueDate: new Date(Date.parse(inv.issueDate) + dueDays * 86400_000).toISOString().slice(0, 10) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inv.issueDate]);

  async function addBillable() {
    if (!inv.clientId) return setMsg("Pick a client first");
    const r = await call(`/api/invoices/billable?clientId=${inv.clientId}&markup=${markup}`, "GET");
    if (!r.lines.length) return setMsg("No un-invoiced billable expenses for this client.");
    const have = new Set(inv.lines.map((l) => l.sourceDocumentId));
    set({ currency: r.currency, lines: [...inv.lines.filter((l) => l.description), ...r.lines.filter((l: LineDraft) => !have.has(l.sourceDocumentId))] });
    setMsg(`${r.lines.length} expense(s) added in ${r.currency}${r.skipped ? `; ${r.skipped} skipped (no USD rate)` : ""}.`);
  }

  async function save(): Promise<string | null> {
    setMsg("");
    const body = { ...inv, lines: inv.lines.filter((l) => l.description.trim()), notes: inv.notes || null };
    try {
      if (inv.id) {
        await call(`/api/invoices/${inv.id}`, "PUT", body);
        return inv.id;
      }
      const r = await call("/api/invoices", "POST", body);
      return r.id;
    } catch (e) {
      setMsg((e as Error).message);
      return null;
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-2 sm:grid-cols-2">
        <label><span className="text-xs muted">Client</span>
          <select className="input" value={inv.clientId} onChange={(e) => set({ clientId: e.target.value })}>
            <option value="">Choose…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label><span className="text-xs muted">Currency</span>
          <select className="input" value={inv.currency} onChange={(e) => set({ currency: e.target.value })}>
            {["USD", "GBP", "EUR", "AED", "PKR"].map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label><span className="text-xs muted">Issue date</span><input className="input" type="date" value={inv.issueDate} onChange={(e) => set({ issueDate: e.target.value })} /></label>
        <label><span className="text-xs muted">Due date</span><input className="input" type="date" value={inv.dueDate} onChange={(e) => set({ dueDate: e.target.value })} /></label>
      </div>

      <div className="space-y-2">
        {inv.lines.map((l, i) => (
          <div key={i} className="rounded-lg border line p-2">
            <input className="input" placeholder="Description" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
            <div className="mt-2 grid grid-cols-[1fr_1fr_auto] gap-2">
              <input className="input" inputMode="decimal" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })} />
              <input className="input" inputMode="decimal" placeholder="Unit price" value={l.unitPrice} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) || 0 })} />
              <button className="btn btn-ghost" onClick={() => set({ lines: inv.lines.filter((_, j) => j !== i) })} aria-label="Remove line">✕</button>
            </div>
            {l.sourceDocumentId && <p className="mt-1 text-xs muted">Re-billed expense</p>}
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-ghost" onClick={() => set({ lines: [...inv.lines, { description: "", quantity: 1, unitPrice: 0 }] })}>+ Line</button>
          <span className="flex items-center gap-1">
            <button className="btn btn-ghost" onClick={addBillable}>+ Billable expenses</button>
            <input className="input !w-20" inputMode="decimal" value={markup} onChange={(e) => setMarkup(Number(e.target.value) || 0)} aria-label="Markup %" />
            <span className="muted">% markup</span>
          </span>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <label><span className="text-xs muted">Tax rate %</span><input className="input" inputMode="decimal" value={inv.taxRate} onChange={(e) => set({ taxRate: Number(e.target.value) || 0 })} /></label>
        <div className="rounded-lg bg-black/5 p-3 text-right dark:bg-white/5">
          <div className="muted">Subtotal {subtotal.toFixed(2)} · Tax {tax.toFixed(2)}</div>
          <div className="text-lg font-semibold">{inv.currency} {(subtotal + tax).toFixed(2)}</div>
        </div>
      </div>
      <label className="block"><span className="text-xs muted">Notes (shown on the invoice)</span><textarea className="input" rows={2} value={inv.notes} onChange={(e) => set({ notes: e.target.value })} /></label>

      <div className="flex gap-2">
        <button className="btn btn-primary flex-1" onClick={async () => {
          const id = await save();
          if (id) router.push(`/invoices/${id}`);
        }}>Save draft</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

export function InvoiceActions({ id, status, clientEmail, sentTo }: { id: string; status: string; clientEmail: string | null; sentTo: string | null }) {
  const router = useRouter();
  const [to, setTo] = useState(clientEmail ?? "");
  const [msg, setMsg] = useState("");
  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    setMsg("");
    if (action === "void" && !confirm("Void this invoice? It stays on record, its revenue is reversed and re-billed expenses are freed.")) return;
    try {
      await call(`/api/invoices/${id}/action`, "POST", { action, ...extra });
      setMsg(action === "send" ? `Sent to ${extra.to}` : "Done");
      router.refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="space-y-2 text-sm">
      <a className="btn btn-ghost w-full" href={`/api/invoices/${id}/pdf`} target="_blank" rel="noreferrer">{status === "draft" ? "Preview PDF" : "Download PDF"}</a>
      {status === "draft" && <button className="btn btn-primary w-full" onClick={() => act("issue")}>Issue (assign number)</button>}
      {status !== "void" && (
        <div className="flex gap-2">
          <input className="input" type="email" placeholder="Client email" value={to} onChange={(e) => setTo(e.target.value)} />
          <button className="btn btn-success shrink-0" onClick={() => act("send", { to })}>{status === "draft" ? "Issue & email" : "Email"}</button>
        </div>
      )}
      {sentTo && <p className="text-xs muted">Last sent to {sentTo}</p>}
      {status === "issued" && <button className="text-xs text-rose-500 underline" onClick={() => act("void")}>Void invoice</button>}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

// ---------------- Settings ----------------

export function InvoiceSettings({ initial, readOnly }: { initial: AppSettings; readOnly: boolean }) {
  const [s, setS] = useState(initial);
  const [msg, setMsg] = useState("");
  async function save() {
    const { companyName, companyAddress, companyEmail, paymentInstructions, invoicePrefix, invoiceDueDays, accountCodes } = s;
    try {
      await call("/api/settings", "PATCH", { companyName, companyAddress, companyEmail, paymentInstructions, invoicePrefix, invoiceDueDays, accountCodes });
      setMsg("Saved");
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  const field = (k: "companyName" | "companyAddress" | "companyEmail" | "invoicePrefix", label: string) => (
    <label className="block"><span className="text-xs muted">{label}</span><input className="input" disabled={readOnly} value={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.value })} /></label>
  );
  return (
    <div className="space-y-2 text-sm">
      {field("companyName", "Company name")}
      {field("companyAddress", "Address")}
      {field("companyEmail", "Reply-to email")}
      <label className="block"><span className="text-xs muted">Payment instructions (bank / Wise / Payoneer details)</span>
        <textarea className="input" rows={3} disabled={readOnly} value={s.paymentInstructions} onChange={(e) => setS({ ...s, paymentInstructions: e.target.value })} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {field("invoicePrefix", "Number prefix (AIN → AIN-2026-001)")}
        <label className="block"><span className="text-xs muted">Payment terms (days)</span><input className="input" type="number" disabled={readOnly} value={s.invoiceDueDays} onChange={(e) => setS({ ...s, invoiceDueDays: Number(e.target.value) })} /></label>
      </div>
      <details>
        <summary className="cursor-pointer text-xs font-semibold">Account codes for Xero / QuickBooks exports</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <label key={k} className="block"><span className="text-xs muted">{v.label}</span>
              <input className="input" disabled={readOnly} value={s.accountCodes[k] ?? ""} onChange={(e) => setS({ ...s, accountCodes: { ...s.accountCodes, [k]: e.target.value } })} />
            </label>
          ))}
        </div>
      </details>
      {!readOnly && <button className="btn btn-primary" onClick={save}>Save</button>}
      {msg && <span className="ml-3 muted">{msg}</span>}
    </div>
  );
}

type UserRow = { id: string; email: string; role: string; totpEnabled: boolean; disabled: boolean };

export function AccountantAccess() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const load = async () => setUsers(await call("/api/users", "GET"));
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="space-y-2 text-sm">
      <ul className="divide-y line">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between py-2">
            <span>{u.email} <span className="muted">· {u.role}{u.totpEnabled ? " · 2FA" : ""}{u.disabled ? " · access revoked" : ""}</span></span>
            {u.role === "accountant" && !u.disabled && <button className="text-xs text-rose-500 underline" onClick={async () => (await call(`/api/users/${u.id}`, "DELETE"), load())}>Revoke</button>}
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-3">
        <input className="input" type="email" placeholder="Accountant email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" type="text" placeholder="Temporary password (12+)" value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn btn-ghost" onClick={async () => {
          try {
            await call("/api/users", "POST", { email, password });
            setMsg(`Added. Share the password privately; ask them to turn on 2FA.`);
            setEmail(""), setPassword("");
            load();
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}>Add accountant</button>
      </div>
      <p className="text-xs muted">Accountants can view everything and download exports and the tax package. They can't change records.</p>
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}
