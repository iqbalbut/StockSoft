import { NextResponse } from "next/server";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { ingest, type IncomingFile } from "@/pipeline/ingest";

export const maxDuration = 300;

/**
 * multipart/form-data: files[] (images, PDFs, ZIPs), source = camera|upload, asPages = "1" for a multi-page
 * capture, batchId (optional, reuse across chunks), batchName (creates a batch on first chunk).
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ write: true });
  const form = await req.formData();
  const files: IncomingFile[] = [];
  for (const v of form.getAll("files")) {
    if (typeof v === "string") continue;
    files.push({ name: v.name || "upload", data: Buffer.from(await v.arrayBuffer()), mimeType: v.type });
  }
  if (!files.length) return NextResponse.json({ error: "No files" }, { status: 400 });

  const source = form.get("source") === "camera" ? "camera" : files.some((f) => /\.zip$/i.test(f.name)) ? "zip" : "upload";
  let batchId = (form.get("batchId") as string | null) || null;
  const batchName = form.get("batchName") as string | null;
  if (!batchId && batchName) {
    const db = await getDb();
    const [b] = await db.insert(schema.batches).values({ name: batchName.slice(0, 120), source, createdBy: user.id }).returning();
    batchId = b.id;
  }
  const result = await ingest({
    files,
    source,
    asPages: form.get("asPages") === "1",
    economy: form.get("economy") === "1",
    batchId,
    actor: { type: "user", id: user.id, ip: await clientIp() },
  });
  return NextResponse.json({ ...result, batchId });
});
