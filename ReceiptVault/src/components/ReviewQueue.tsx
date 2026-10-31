"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ClientDoc } from "@/pipeline/queries";
import { REASON_LABELS, type ReviewReason } from "@/pipeline/route";
import { DocumentFields } from "./DocumentFields";
import { money } from "./format";

const SWIPE = 110; // px to commit a swipe

export function Preview({ doc, className = "" }: { doc: ClientDoc; className?: string }) {
  const [page, setPage] = useState(0);
  const f = doc.files[page];
  if (!f) return null;
  return (
    <div className={`relative overflow-hidden rounded-xl bg-black/5 dark:bg-white/5 ${className}`}>
      {f.mimeType.startsWith("image/") ? (
        <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/files/${f.id}?w=900`} alt={doc.originalFilename} className="mx-auto max-h-[42vh] w-full object-contain" draggable={false} />
        </a>
      ) : f.mimeType === "application/pdf" ? (
        <iframe src={`/api/files/${f.id}#toolbar=0&view=FitH`} className="h-[42vh] w-full" title={doc.originalFilename} />
      ) : (
        <iframe src={`/api/files/${f.id}`} className="h-[30vh] w-full bg-white" title={doc.originalFilename} sandbox="" />
      )}
      {doc.files.length > 1 && (
        <div className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1 rounded-full bg-black/50 px-2 py-1">
          {doc.files.map((_, i) => (
            <button key={i} onClick={() => setPage(i)} className={`h-2 w-2 rounded-full ${i === page ? "bg-white" : "bg-white/40"}`} aria-label={`Page ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One-thumb review: the top card is the current document. Swipe right (or tap Approve) to approve,
 * swipe left to skip it for now, tap any field to fix it.
 */
export function ReviewQueue({ readOnly }: { readOnly: boolean }) {
  const [queue, setQueue] = useState<ClientDoc[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dx, setDx] = useState(0);
  const [done, setDone] = useState(0);
  const start = useRef<{ x: number; y: number } | null>(null);
  const dxRef = useRef(0); // latest drag distance (state lags behind fast touch events)

  const load = useCallback(async () => {
    const res = await fetch("/api/documents?status=needs_review,duplicate&order=oldest&limit=50");
    const data = await res.json();
    setQueue(data.items);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const current = queue?.[0];

  async function act(action: "approve" | "reject") {
    if (!current || busy) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/documents/${current.id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const data = await res.json();
    setBusy(false);
    setDx(0);
    if (!res.ok) {
      setError(data.error);
      return;
    }
    if (navigator.vibrate) navigator.vibrate(15);
    setDone((n) => n + 1);
    setQueue((q) => q!.slice(1));
    if ((queue?.length ?? 0) <= 2) void load();
  }

  function skip() {
    setDx(0);
    setQueue((q) => (q && q.length > 1 ? [...q.slice(1), q[0]] : q));
  }

  if (!queue) return <p className="muted">Loading…</p>;
  if (!current) {
    return (
      <div className="card p-8 text-center">
        <div className="text-4xl">✓</div>
        <h2 className="mt-2 text-lg font-semibold">Review queue is empty</h2>
        <p className="mt-1 text-sm muted">{done ? `You cleared ${done} document${done === 1 ? "" : "s"}. ` : ""}Everything else was confident enough to file automatically.</p>
        <Link href="/capture" className="btn btn-primary mt-4">Capture a receipt</Link>
      </div>
    );
  }

  const reasons = (current.reviewReasons ?? []) as ReviewReason[];
  const isDup = current.status === "duplicate";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="muted">{queue.length} to review{done ? ` · ${done} done` : ""}</span>
        <span className="muted hidden sm:inline">Swipe → approve · ← skip</span>
      </div>
      <div
        className="card relative touch-pan-y select-none p-3 transition-transform"
        style={{ transform: `translateX(${dx}px) rotate(${dx / 40}deg)`, transitionDuration: start.current ? "0ms" : "200ms" }}
        onTouchStart={(e) => {
          if ((e.target as HTMLElement).closest("input,select,button,form,iframe,a")) return;
          start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!start.current) return;
          const ddx = e.touches[0].clientX - start.current.x;
          const ddy = e.touches[0].clientY - start.current.y;
          if (Math.abs(ddx) > Math.abs(ddy)) {
            dxRef.current = ddx;
            setDx(ddx);
          }
        }}
        onTouchEnd={() => {
          start.current = null;
          const d = dxRef.current;
          dxRef.current = 0;
          if (d > SWIPE && !readOnly && !isDup) void act("approve");
          else if (d < -SWIPE) skip();
          else setDx(0);
        }}
      >
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-between px-6 text-2xl font-bold">
          <span className="text-emerald-500" style={{ opacity: Math.max(0, dx / SWIPE) }}>APPROVE</span>
          <span className="text-slate-400" style={{ opacity: Math.max(0, -dx / SWIPE) }}>SKIP</span>
        </div>
        <Preview doc={current} />
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {reasons.map((r) => (
            <span key={r} className="chip bg-amber-500/15 text-amber-700 dark:text-amber-300">{REASON_LABELS[r] ?? r}</span>
          ))}
          {current.totalUsd && current.currency !== "USD" && <span className="chip bg-slate-500/10 muted">≈ {money(current.totalUsd, "USD")}</span>}
          <Link href={`/documents/${current.id}`} className="chip ml-auto bg-slate-500/10 muted">Details</Link>
        </div>
        {isDup && current.duplicateOfId && (
          <p className="mt-2 rounded-lg bg-violet-500/10 p-2 text-sm">
            Looks like a copy of{" "}
            <Link className="underline" href={`/documents/${current.duplicateOfId}`}>an earlier document</Link>. Discard it, or approve if it is a separate purchase.
          </p>
        )}
        {current.notes && <p className="mt-2 text-sm muted">“{current.notes}”</p>}
        <div className="mt-2">
          <DocumentFields compact doc={current} readOnly={readOnly} onSaved={(d) => setQueue((q) => [d, ...q!.slice(1)])} />
        </div>
      </div>
      {error && <p className="text-sm text-rose-500">{error}</p>}
      {!readOnly && <div className="h-20 md:hidden" aria-hidden />}
      {!readOnly && (
        <div className="safe-bottom fixed inset-x-0 bottom-16 z-20 px-4 md:static md:px-0">
          <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
            <button className="btn btn-ghost" onClick={() => act("reject")} disabled={busy}>{isDup ? "Discard" : "Reject"}</button>
            <button className="btn btn-ghost" onClick={skip} disabled={busy}>Skip</button>
            <button className="btn btn-success" onClick={() => act("approve")} disabled={busy}>Approve</button>
          </div>
        </div>
      )}
    </div>
  );
}
