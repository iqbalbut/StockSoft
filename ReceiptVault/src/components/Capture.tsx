"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Pending = { id: string; blobs: Blob[]; names: string[]; asPages: boolean; createdAt: number };

// ---- tiny IndexedDB queue: captures survive offline use and app restarts ----
const DB_NAME = "receiptvault-capture";
function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("pending", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction("pending", mode).objectStore("pending"));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const putPending = (p: Pending) => tx("readwrite", (s) => s.put(p));
const delPending = (id: string) => tx("readwrite", (s) => s.delete(id));
const allPending = () => tx<Pending[]>("readonly", (s) => s.getAll() as IDBRequest<Pending[]>);

/**
 * Re-encodes a photo as JPEG (max 2400px). This also converts iPhone HEIC to JPEG in Safari, and cuts
 * upload size ~5x on mobile data. Falls back to the original file if the browser can't decode it.
 */
async function compress(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const url = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", 0.85));
  } catch {
    return file;
  }
}

export function Capture() {
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [pages, setPages] = useState<{ blob: Blob; url: string }[]>([]);
  const [pending, setPending] = useState(0);
  const [sent, setSent] = useState(0);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState("");
  const syncing = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => setPending((await allPending()).length), []);

  const sync = useCallback(async () => {
    if (syncing.current || !navigator.onLine) return;
    syncing.current = true;
    try {
      for (const p of await allPending()) {
        const form = new FormData();
        p.blobs.forEach((b, i) => form.append("files", b, p.names[i]));
        form.append("source", "camera");
        if (p.asPages) form.append("asPages", "1");
        const res = await fetch("/api/upload", { method: "POST", body: form });
        if (res.status === 401) {
          setMessage("Signed out. Sign in again to upload your saved captures.");
          break;
        }
        if (!res.ok) break; // keep it queued; retry later
        const data = await res.json();
        if (data.rejected?.length) setMessage(`Not accepted: ${data.rejected.map((r: { reason: string }) => r.reason).join("; ")}`);
        await delPending(p.id);
        setSent((n) => n + 1);
      }
    } catch {
      // network dropped mid-sync: items stay queued
    } finally {
      syncing.current = false;
      await refresh();
    }
  }, [refresh]);

  useEffect(() => {
    setOnline(navigator.onLine);
    void refresh().then(sync);
    const on = () => {
      setOnline(navigator.onLine);
      void sync();
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    const t = setInterval(sync, 20_000);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
      clearInterval(t);
    };
  }, [refresh, sync]);

  async function queue(blobs: Blob[], asPages: boolean) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await putPending({ id: crypto.randomUUID(), blobs, names: blobs.map((_, i) => `capture-${stamp}-${i + 1}.jpg`), asPages, createdAt: Date.now() });
    await refresh();
    void sync();
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    const blobs = await Promise.all([...list].map(compress));
    if (navigator.vibrate) navigator.vibrate(10);
    if (mode === "multi") setPages((p) => [...p, ...blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) }))]);
    else for (const b of blobs) await queue([b], false);
    if (input.current) input.current.value = "";
  }

  async function finishMulti() {
    if (!pages.length) return;
    await queue(pages.map((p) => p.blob), true);
    pages.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-black/5 p-1 dark:bg-white/5">
        {(["single", "multi"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-lg py-2 text-sm font-semibold ${mode === m ? "bg-[var(--card)] shadow" : "muted"}`}>
            {m === "single" ? "Batch: 1 photo = 1 receipt" : "Multi-page document"}
          </button>
        ))}
      </div>

      <label className="card flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed text-center active:scale-[0.99]">
        <span className="grid h-20 w-20 place-items-center rounded-full bg-brand-600 text-white shadow-lg">
          <svg viewBox="0 0 24 24" className="h-10 w-10" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg>
        </span>
        <span className="text-lg font-semibold">{mode === "single" ? "Tap to snap a receipt" : `Snap page ${pages.length + 1}`}</span>
        <span className="max-w-xs text-sm muted">
          {mode === "single" ? "Keep snapping: each photo uploads in the background. Lay receipts on a dark surface, fill the frame." : "Add every page, then tap Done to file them as one document."}
        </span>
        <input ref={input} type="file" accept="image/*,application/pdf" capture="environment" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
      </label>

      {mode === "multi" && pages.length > 0 && (
        <div className="card p-3">
          <div className="flex gap-2 overflow-x-auto">
            {pages.map((p, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.url} src={p.url} alt={`Page ${i + 1}`} className="h-24 w-auto rounded-lg border line" />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn btn-ghost flex-1" onClick={() => setPages((p) => p.slice(0, -1))}>Remove last</button>
            <button className="btn btn-primary flex-1" onClick={finishMulti}>Done ({pages.length} pages)</button>
          </div>
        </div>
      )}

      <div className="card flex items-center justify-between p-4 text-sm">
        <div>
          <div className="font-semibold">{pending ? `${pending} waiting to upload` : sent ? `${sent} uploaded this session` : "Ready"}</div>
          <div className="muted">{online ? "Online: uploads happen automatically" : "Offline: captures are saved on this phone and upload when you're back online"}</div>
        </div>
        {pending > 0 && online && <button className="btn btn-ghost" onClick={sync}>Retry</button>}
      </div>
      {message && <p className="text-sm text-amber-600">{message}</p>}
      <p className="text-center text-sm muted">
        Have a pile of PDFs or a ZIP? <Link className="underline" href="/upload">Bulk upload</Link>
      </p>
    </div>
  );
}
