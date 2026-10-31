"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientDoc } from "@/pipeline/queries";
import { REASON_LABELS, type ReviewReason } from "@/pipeline/route";
import { DocumentFields } from "./DocumentFields";
import { Preview } from "./ReviewQueue";
import { money, STATUS_LABEL, STATUS_STYLE } from "./format";

type Detail = ClientDoc & {
  lineItems: { id: string; description: string; quantity: string | null; amount: string | null }[];
  auditTrail: { id: number; actorType: string; actorId: string | null; action: string; changes: unknown; createdAt: string }[];
};

export function DocumentDetail({ initial, readOnly }: { initial: Detail; readOnly: boolean }) {
  const [doc, setDoc] = useState(initial);
  const [error, setError] = useState("");
  const router = useRouter();

  async function act(action: "approve" | "reject" | "reprocess") {
    setError("");
    const res = await fetch(`/api/documents/${doc.id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    if (!res.ok) return setError((await res.json()).error);
    router.refresh();
    const fresh = await (await fetch(`/api/documents/${doc.id}`)).json();
    setDoc(fresh);
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
      <div className="space-y-3">
        <Preview doc={doc} />
        <div className="card space-y-1 p-4 text-sm">
          <div className="flex justify-between"><span className="muted">Archived as</span><span className="min-w-0 truncate pl-2 font-mono text-xs">{doc.archivedFilename ?? "—"}</span></div>
          <div className="flex justify-between"><span className="muted">Original file</span><span className="min-w-0 truncate pl-2">{doc.originalFilename}</span></div>
          <div className="flex justify-between"><span className="muted">Source</span><span>{doc.source}</span></div>
          <div className="flex justify-between"><span className="muted">USD at {doc.fxDate ?? "—"}</span><span>{money(doc.totalUsd, "USD")}{doc.fxRate && doc.currency !== "USD" ? ` (1 USD = ${Number(doc.fxRate).toFixed(4)} ${doc.currency})` : ""}</span></div>
          <div className="flex justify-between"><span className="muted">Retain until</span><span>{doc.retainUntil ?? "—"}</span></div>
          <div className="flex justify-between"><span className="muted">SHA-256</span><span className="min-w-0 truncate pl-2 font-mono text-xs">{doc.sha256.slice(0, 16)}…</span></div>
          <div className="flex gap-2 pt-2">
            {doc.files.map((f) => (
              <a key={f.id} className="btn btn-ghost flex-1 text-sm" href={`/api/files/${f.id}?download=1`}>Download original{doc.files.length > 1 ? ` p${f.pageNo}` : ""}</a>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-3">
        <div className="card p-4">
          <div className="flex items-center justify-between">
            <span className={`chip ${STATUS_STYLE[doc.status]}`}>{STATUS_LABEL[doc.status]}{doc.autoApproved ? " (auto)" : ""}</span>
            {doc.overallConfidence != null && <span className="text-sm muted">Confidence {Math.round(doc.overallConfidence * 100)}%</span>}
          </div>
          {doc.reviewReasons?.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {(doc.reviewReasons as ReviewReason[]).map((r) => <span key={r} className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">{REASON_LABELS[r] ?? r}</span>)}
            </div>
          )}
          {doc.error && <p className="mt-2 text-sm text-rose-500">{doc.error}</p>}
          <div className="mt-2"><DocumentFields doc={doc} readOnly={readOnly} onSaved={(d) => setDoc({ ...doc, ...d })} /></div>
          {!readOnly && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <button className="btn btn-ghost" onClick={() => act("reprocess")}>Re-read</button>
              <button className="btn btn-ghost" onClick={() => act("reject")} disabled={doc.status === "rejected"}>Reject</button>
              <button className="btn btn-success" onClick={() => act("approve")} disabled={doc.status === "approved"}>Approve</button>
            </div>
          )}
          {error && <p className="mt-2 text-sm text-rose-500">{error}</p>}
        </div>
        {doc.lineItems.length > 0 && (
          <div className="card p-4">
            <h2 className="font-semibold">Line items</h2>
            <ul className="mt-2 divide-y line text-sm">
              {doc.lineItems.map((li) => (
                <li key={li.id} className="flex justify-between gap-2 py-1.5"><span>{li.quantity && Number(li.quantity) !== 1 ? `${Number(li.quantity)} × ` : ""}{li.description}</span><span className="tabular-nums">{money(li.amount, doc.currency)}</span></li>
              ))}
            </ul>
          </div>
        )}
        <div className="card p-4">
          <h2 className="font-semibold">Audit trail</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {doc.auditTrail.map((a) => (
              <li key={a.id} className="border-l-2 line pl-3">
                <div><span className="font-medium">{a.action.replace(/_/g, " ")}</span> <span className="muted">by {a.actorType}{a.actorType === "ai" ? ` (${a.actorId})` : ""} · {new Date(a.createdAt).toLocaleString()}</span></div>
                {a.action === "edited" && a.changes ? (
                  <div className="text-xs muted">
                    {Object.entries(a.changes as Record<string, { from: unknown; to: unknown }>).filter(([k]) => !["archivedFilename", "fxRate", "fxDate", "totalUsd", "reviewReasons", "vendorId", "retainUntil"].includes(k)).map(([k, v]) => (
                      <div key={k}>{k}: {String(v.from ?? "—")} → {String(v.to ?? "—")}</div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
