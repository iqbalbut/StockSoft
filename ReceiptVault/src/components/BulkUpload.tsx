"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Rejected = { filename: string; reason: string };
const CHUNK_BYTES = 20 * 1024 * 1024; // keep each request well under proxy limits
const CHUNK_FILES = 15;

function chunk(files: File[]) {
  const out: File[][] = [];
  let cur: File[] = [];
  let size = 0;
  for (const f of files) {
    if (cur.length && (cur.length >= CHUNK_FILES || size + f.size > CHUNK_BYTES)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Drag-and-drop / multi-select bulk upload (images, PDFs, ZIPs) with backlog batch tracking. */
export function BulkUpload() {
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [batchName, setBatchName] = useState(`Backlog ${new Date().toISOString().slice(0, 10)}`);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [accepted, setAccepted] = useState(0);
  const [dupes, setDupes] = useState(0);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState("");
  const [economy, setEconomy] = useState(false);

  useEffect(() => {
    if (!batchId) return;
    const tick = async () => {
      const r = await fetch(`/api/batches/${batchId}`);
      if (r.ok) setCounts((await r.json()).counts);
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [batchId]);

  async function upload() {
    setError("");
    const parts = chunk(files);
    setProgress({ sent: 0, total: files.length });
    let id = batchId;
    for (const part of parts) {
      const form = new FormData();
      part.forEach((f) => form.append("files", f, f.name));
      form.append("source", "upload");
      if (economy) form.append("economy", "1");
      if (id) form.append("batchId", id);
      else form.append("batchName", batchName);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Upload failed (${res.status})`);
        break;
      }
      id = data.batchId;
      setBatchId(id);
      setAccepted((n) => n + data.documents.filter((d: { status: string }) => d.status !== "duplicate").length);
      setDupes((n) => n + data.documents.filter((d: { status: string }) => d.status === "duplicate").length);
      setRejected((r) => [...r, ...data.rejected]);
      setProgress((p) => ({ sent: p!.sent + part.length, total: p!.total }));
    }
    setFiles([]);
  }

  const pending = counts ? (counts.queued ?? 0) + (counts.processing ?? 0) : 0;
  const totalInBatch = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="space-y-4">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)]);
        }}
        className={`card flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed p-6 text-center ${drag ? "border-brand-500 bg-brand-500/5" : ""}`}
      >
        <span className="text-lg font-semibold">Drop receipts, PDFs or a ZIP here</span>
        <span className="text-sm muted">or tap to choose files · JPG, PNG, WEBP, PDF, ZIP · up to 25 MB each</span>
        <input type="file" multiple accept="image/*,application/pdf,.zip,application/zip" className="hidden" onChange={(e) => setFiles((f) => [...f, ...Array.from(e.target.files ?? [])])} />
      </label>

      {files.length > 0 && (
        <div className="card space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{files.length} file{files.length === 1 ? "" : "s"} selected</span>
            <button className="text-sm muted underline" onClick={() => setFiles([])}>Clear</button>
          </div>
          <label className="block text-sm">
            <span className="muted">Batch name (for tracking this backlog session)</span>
            <input className="input mt-1" value={batchName} onChange={(e) => setBatchName(e.target.value)} disabled={!!batchId} />
          </label>
          <label className="flex items-start gap-3 rounded-lg bg-black/5 p-3 text-sm dark:bg-white/5">
            <input type="checkbox" className="mt-1 h-5 w-5" checked={economy} onChange={(e) => setEconomy(e.target.checked)} disabled={!!batchId} />
            <span>
              <span className="font-semibold">Economy mode: half the AI cost</span>
              <span className="block muted">Uses the Batch API. Results arrive within about an hour (at most 24 h) instead of seconds. Good for a backlog.</span>
            </span>
          </label>
          <button className="btn btn-primary w-full" onClick={upload} disabled={!!progress && progress.sent < progress.total}>
            Upload and process
          </button>
        </div>
      )}

      {progress && (
        <div className="card space-y-3 p-4">
          <div>
            <div className="flex justify-between text-sm"><span>Uploaded</span><span>{progress.sent}/{progress.total}</span></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
              <div className="h-full bg-brand-500 transition-all" style={{ width: `${(progress.sent / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
          </div>
          {counts && (
            <div>
              <div className="flex justify-between text-sm"><span>Processed by AI</span><span>{totalInBatch - pending}/{totalInBatch}</span></div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/10">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${((totalInBatch - pending) / Math.max(totalInBatch, 1)) * 100}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                <div className="rounded-lg bg-emerald-500/10 p-2"><div className="text-lg font-bold">{counts.approved ?? 0}</div>auto-filed</div>
                <div className="rounded-lg bg-amber-500/10 p-2"><div className="text-lg font-bold">{(counts.needs_review ?? 0) + (counts.duplicate ?? 0)}</div>to review</div>
                <div className="rounded-lg bg-rose-500/10 p-2"><div className="text-lg font-bold">{counts.failed ?? 0}</div>failed</div>
              </div>
            </div>
          )}
          <p className="text-sm muted">
            {accepted} queued{dupes ? `, ${dupes} exact duplicates skipped` : ""}. You can leave this page: processing continues on the server.
          </p>
          <Link href="/review" className="btn btn-ghost w-full">Start reviewing now</Link>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="card p-4 text-sm">
          <div className="font-semibold text-rose-500">{rejected.length} file(s) not accepted</div>
          <ul className="mt-2 space-y-1">
            {rejected.slice(0, 50).map((r, i) => (
              <li key={i}><span className="font-medium">{r.filename}</span> <span className="muted">{r.reason}</span></li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="text-sm text-rose-500">{error}</p>}
    </div>
  );
}
