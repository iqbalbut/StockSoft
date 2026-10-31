"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@/extraction/schema";

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.issues?.[0]?.message ?? data.error ?? "Failed");
  return data;
}

/** "Mark paid" with date (default today), amount (default total) and reference. */
export function MarkPaid({ id, total, currency, paid }: { id: string; total: string | null; currency: string | null; paid?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(total ?? "");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState("");
  if (paid)
    return (
      <button className="text-xs muted underline" onClick={async () => (await call(`/api/documents/${id}/payment`, "POST", { action: "unpaid" }), router.refresh())}>
        Undo
      </button>
    );
  if (!open) return <button className="btn btn-ghost !min-h-9 !py-1 text-sm" onClick={() => setOpen(true)}>Mark paid</button>;
  return (
    <form
      className="mt-2 grid w-full grid-cols-2 gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await call(`/api/documents/${id}/payment`, "POST", { action: "paid", paidAt, paidAmount: amount || undefined, paymentRef: ref || undefined });
          router.refresh();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <input className="input" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
      <input className="input" inputMode="decimal" placeholder={`Amount (${currency ?? ""})`} value={amount} onChange={(e) => setAmount(e.target.value)} />
      <input className="input col-span-2" placeholder="Reference (e.g. IBFT / cheque #)" value={ref} onChange={(e) => setRef(e.target.value)} />
      <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      <button className="btn btn-success">Save payment</button>
      {err && <p className="col-span-2 text-sm text-rose-500">{err}</p>}
    </form>
  );
}

export function AddClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  return (
    <form
      className="grid gap-2 sm:grid-cols-4"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          await call("/api/clients", "POST", { name, code: code || null, email: email || null });
          setName(""), setCode(""), setEmail("");
          router.refresh();
        } catch (x) {
          setErr((x as Error).message);
        }
      }}
    >
      <input className="input sm:col-span-2" placeholder="Client name" required value={name} onChange={(e) => setName(e.target.value)} />
      <input className="input" placeholder="Code (e.g. ACME)" value={code} onChange={(e) => setCode(e.target.value)} />
      <input className="input" type="email" placeholder="Billing email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button className="btn btn-primary sm:col-span-4">Add client</button>
      {err && <p className="text-sm text-rose-500 sm:col-span-4">{err}</p>}
    </form>
  );
}

export function RebillSelected({ clientId, ids }: { clientId: string; ids: string[] }) {
  const router = useRouter();
  if (!ids.length) return null;
  return (
    <button className="btn btn-primary w-full" onClick={async () => (await call(`/api/clients/${clientId}/rebill`, "POST", { documentIds: ids }), router.refresh())}>
      Mark all {ids.length} as re-invoiced
    </button>
  );
}

type Rule = { id: string; name: string; defaultCategory: string | null; defaultIsBusiness: boolean | null; defaultIsBillable: boolean | null; defaultClientId: string | null; documents: number };

export function RuleRow({ rule, clients, readOnly }: { rule: Rule; clients: { id: string; name: string }[]; readOnly: boolean }) {
  const [r, setR] = useState(rule);
  const [msg, setMsg] = useState("");
  async function save(patch: Partial<Rule>) {
    setR({ ...r, ...patch });
    try {
      const res = await call(`/api/vendors/${r.id}`, "PATCH", patch);
      setMsg(res.applied ? `Applied to ${res.applied} in review${res.autoApproved ? `, ${res.autoApproved} auto-approved` : ""}` : "Saved");
    } catch (x) {
      setMsg((x as Error).message);
    }
  }
  const tri = (v: boolean | null) => (v == null ? "" : v ? "yes" : "no");
  const fromTri = (v: string) => (v === "" ? null : v === "yes");
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium">{r.name}</span>
        <span className="shrink-0 text-xs muted">{r.documents} doc{r.documents === 1 ? "" : "s"}</span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <label className="block"><span className="text-xs muted">Category</span>
        <select className="input" disabled={readOnly} value={r.defaultCategory ?? ""} onChange={(e) => save({ defaultCategory: e.target.value || null })}>
          <option value="">AI decides</option>
          {Object.entries(CATEGORIES).filter(([k]) => k !== "revenue").map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select></label>
        <label className="block"><span className="text-xs muted">Business or personal</span>
        <select className="input" disabled={readOnly} value={tri(r.defaultIsBusiness)} onChange={(e) => save({ defaultIsBusiness: fromTri(e.target.value) })}>
          <option value="">AI decides</option>
          <option value="yes">Business</option>
          <option value="no">Personal</option>
        </select></label>
        <label className="block"><span className="text-xs muted">Billable</span>
        <select className="input" disabled={readOnly} value={tri(r.defaultIsBillable)} onChange={(e) => save({ defaultIsBillable: fromTri(e.target.value) })}>
          <option value="">AI decides</option>
          <option value="yes">Always</option>
          <option value="no">Never</option>
        </select></label>
        <label className="block"><span className="text-xs muted">Client</span>
        <select className="input" disabled={readOnly} value={r.defaultClientId ?? ""} onChange={(e) => save({ defaultClientId: e.target.value || null })}>
          <option value="">None</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select></label>
      </div>
      {msg && <p className="mt-1 text-xs muted">{msg}</p>}
    </div>
  );
}

type Endpoint = { id: string; url: string; events: string[]; active: boolean; lastStatus: string | null };
const EVENT_OPTIONS = ["*", "document.processed", "document.approved", "document.needs_review", "bill.due_soon", "bill.paid", "invoice.paid", "digest.weekly"];

export function Webhooks({ initial }: { initial: Endpoint[] }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["digest.weekly", "bill.due_soon"]);
  const [secret, setSecret] = useState("");
  const [err, setErr] = useState("");
  return (
    <div className="space-y-3 text-sm">
      {initial.filter((e) => e.active).map((e) => (
        <div key={e.id} className="rounded-lg border line p-2">
          <div className="truncate font-mono text-xs">{e.url}</div>
          <div className="muted text-xs">{e.events.join(", ")} · last: {e.lastStatus ?? "never"}</div>
          <div className="mt-1 flex gap-3 text-xs">
            <button className="underline" onClick={async () => (await call(`/api/webhooks/${e.id}`, "POST"), setTimeout(() => router.refresh(), 2500))}>Send test</button>
            <button className="text-rose-500 underline" onClick={async () => (await call(`/api/webhooks/${e.id}`, "DELETE"), router.refresh())}>Remove</button>
          </div>
        </div>
      ))}
      <input className="input" placeholder="https://your-n8n/webhook/…" value={url} onChange={(e) => setUrl(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {EVENT_OPTIONS.map((ev) => (
          <button key={ev} type="button" onClick={() => setEvents((s) => (s.includes(ev) ? s.filter((x) => x !== ev) : [...s, ev]))} className={`chip ${events.includes(ev) ? "bg-brand-600 text-white" : "bg-slate-500/10 muted"}`}>
            {ev === "*" ? "all events" : ev}
          </button>
        ))}
      </div>
      <button
        className="btn btn-ghost"
        onClick={async () => {
          try {
            const r = await call("/api/webhooks", "POST", { url, events });
            setSecret(r.secret);
            setUrl("");
            router.refresh();
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        Add webhook
      </button>
      {secret && <p className="rounded-lg bg-amber-500/10 p-2">Signing secret (shown once): <span className="font-mono break-all">{secret}</span></p>}
      {err && <p className="text-rose-500">{err}</p>}
    </div>
  );
}

export function DigestPanel() {
  const [preview, setPreview] = useState("");
  const [msg, setMsg] = useState("");
  return (
    <div className="space-y-2 text-sm">
      <div className="flex gap-2">
        <button className="btn btn-ghost" onClick={async () => setPreview((await call("/api/digest", "GET")).text)}>Preview this week</button>
        <button className="btn btn-ghost" onClick={async () => (await call("/api/digest", "POST"), setMsg("Sending…"))}>Send now</button>
      </div>
      {msg && <p className="muted">{msg}</p>}
      {preview && <pre className="whitespace-pre-wrap rounded-lg bg-black/5 p-3 text-xs dark:bg-white/5">{preview}</pre>}
    </div>
  );
}
