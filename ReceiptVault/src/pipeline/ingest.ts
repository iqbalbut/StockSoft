import JSZip from "jszip";
import { and, eq, notInArray, asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { putObject } from "@/lib/storage";
import { audit, type Actor } from "@/lib/audit";
import { enqueue } from "./jobs";
import { extForMime } from "./naming";

export type IncomingFile = { name: string; data: Buffer; mimeType?: string };
export type Source = (typeof schema.documents.$inferInsert)["source"];

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 1000;

/** Detects the real type from magic bytes; the client-supplied MIME type is not trusted. */
export function sniffMime(buf: Buffer, name = ""): string | null {
  if (buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return "application/zip";
  if (buf.subarray(4, 12).toString("latin1").match(/ftyp(heic|heix|mif1|hevc)/)) return "image/heic";
  if (/\.(txt|eml)$/i.test(name)) return "text/plain";
  if (/\.html?$/i.test(name)) return "text/html";
  return null;
}

export type IngestResult = {
  documents: { id: string; filename: string; status: string; duplicateOf?: string }[];
  rejected: { filename: string; reason: string }[];
};

/** Expands ZIP archives (one level) and validates every file. */
async function expand(files: IncomingFile[]) {
  const ok: (IncomingFile & { mimeType: string })[] = [];
  const rejected: IngestResult["rejected"] = [];
  for (const f of files) {
    if (f.data.length > MAX_FILE_BYTES) {
      rejected.push({ filename: f.name, reason: "File is larger than 25 MB" });
      continue;
    }
    const mime = sniffMime(f.data, f.name);
    if (mime === "application/zip") {
      const zip = await JSZip.loadAsync(f.data);
      const entries = Object.values(zip.files).filter((e) => !e.dir && !/(^|\/)(__MACOSX|\.)/.test(e.name));
      if (entries.length > MAX_ZIP_ENTRIES) {
        rejected.push({ filename: f.name, reason: `ZIP has more than ${MAX_ZIP_ENTRIES} files; split it` });
        continue;
      }
      for (const entry of entries) {
        const data = await entry.async("nodebuffer");
        const inner = sniffMime(data, entry.name);
        const name = entry.name.split("/").pop()!;
        if (!inner || inner === "application/zip") rejected.push({ filename: `${f.name}/${name}`, reason: "Unsupported file type" });
        else if (inner === "image/heic") rejected.push({ filename: `${f.name}/${name}`, reason: "HEIC photo: export as JPEG (iPhone: Settings → Camera → Formats → Most Compatible)" });
        else if (data.length > MAX_FILE_BYTES) rejected.push({ filename: `${f.name}/${name}`, reason: "File is larger than 25 MB" });
        else ok.push({ name, data, mimeType: inner });
      }
    } else if (mime === "image/heic") {
      rejected.push({ filename: f.name, reason: "HEIC photo: export as JPEG (iPhone: Settings → Camera → Formats → Most Compatible)" });
    } else if (!mime) {
      rejected.push({ filename: f.name, reason: "Unsupported file type (use JPG, PNG, WEBP, PDF or ZIP)" });
    } else {
      ok.push({ ...f, mimeType: mime });
    }
  }
  return { ok, rejected };
}

/**
 * Stores files and queues them for extraction.
 * `asPages: true` turns all files into ONE multi-page document (camera multi-page capture);
 * otherwise each file is its own document (bulk/backlog upload).
 */
export async function ingest(opts: {
  files: IncomingFile[];
  source: Source;
  actor: Actor;
  asPages?: boolean;
  batchId?: string | null;
  sourceRef?: string | null;
}): Promise<IngestResult> {
  const db = await getDb();
  const { ok, rejected } = await expand(opts.files);
  const groups = opts.asPages && ok.length ? [ok] : ok.map((f) => [f]);
  const result: IngestResult = { documents: [], rejected };

  for (const [i, group] of groups.entries()) {
    const first = group[0];
    const hash = sha256(first.data);
    const sourceRef = opts.sourceRef ? (groups.length > 1 ? `${opts.sourceRef}#${i}` : opts.sourceRef) : null;

    if (sourceRef) {
      const seen = await db.query.documents.findFirst({
        columns: { id: true },
        where: and(eq(schema.documents.source, opts.source), eq(schema.documents.sourceRef, sourceRef)),
      });
      if (seen) continue; // already ingested (Gmail/Drive re-poll)
    }

    // Exact re-upload of a file we already have: record it as a duplicate without paying for extraction.
    const exact = await db.query.documents.findFirst({
      columns: { id: true },
      where: and(eq(schema.documents.sha256, hash), notInArray(schema.documents.status, ["rejected", "duplicate", "failed"])),
      orderBy: asc(schema.documents.createdAt),
    });

    const [doc] = await db
      .insert(schema.documents)
      .values({
        source: opts.source,
        sourceRef,
        batchId: opts.batchId ?? null,
        originalFilename: first.name.slice(0, 255),
        sha256: hash,
        status: exact ? "duplicate" : "queued",
        duplicateOfId: exact?.id ?? null,
        reviewReasons: exact ? ["duplicate_suspected"] : [],
      })
      .returning({ id: schema.documents.id });

    for (const [p, f] of group.entries()) {
      const key = `originals/${new Date().toISOString().slice(0, 7)}/${doc.id}/p${p + 1}.${extForMime(f.mimeType)}`;
      await putObject(key, f.data);
      await db.insert(schema.documentFiles).values({
        documentId: doc.id,
        pageNo: p + 1,
        storageKey: key,
        mimeType: f.mimeType,
        sizeBytes: f.data.length,
        sha256: p === 0 ? hash : sha256(f.data),
      });
    }

    await audit(opts.actor, "document", doc.id, "ingested", {
      source: opts.source,
      filename: first.name,
      pages: group.length,
      ...(exact ? { exactDuplicateOf: exact.id } : {}),
    });
    if (!exact) await enqueue("process_document", { documentId: doc.id });
    result.documents.push({ id: doc.id, filename: first.name, status: exact ? "duplicate" : "queued", duplicateOf: exact?.id });
  }
  return result;
}

export async function alreadyIngested(source: Source, sourceRef: string) {
  const db = await getDb();
  const row = await db.query.documents.findFirst({
    columns: { id: true },
    where: and(eq(schema.documents.source, source), eq(schema.documents.sourceRef, sourceRef)),
  });
  return Boolean(row);
}
