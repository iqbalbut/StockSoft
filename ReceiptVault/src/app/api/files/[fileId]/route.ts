import { eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { getObject } from "@/lib/storage";

/** Streams a decrypted original (auth required). ?w=480 returns a resized JPEG preview of images. */
export const GET = handler(async (req: Request, { params }: { params: Promise<{ fileId: string }> }) => {
  await requireUser();
  const db = await getDb();
  const file = await db.query.documentFiles.findFirst({ where: eq(schema.documentFiles.id, (await params).fileId) });
  if (!file) return new Response("Not found", { status: 404 });
  const doc = await db.query.documents.findFirst({ columns: { archivedFilename: true, originalFilename: true }, where: eq(schema.documents.id, file.documentId) });
  let body = await getObject(file.storageKey);
  let type = file.mimeType;
  const w = Number(new URL(req.url).searchParams.get("w"));
  if (w > 0 && file.mimeType.startsWith("image/")) {
    body = await sharp(body, { failOn: "none" }).rotate().resize({ width: Math.min(w, 2000), withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
    type = "image/jpeg";
  }
  const name = (doc?.archivedFilename ?? doc?.originalFilename ?? "document").replace(/["\r\n]/g, "");
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": type.startsWith("text/") ? "text/plain; charset=utf-8" : type,
      "cache-control": "private, max-age=3600",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${file.pageNo > 1 ? `p${file.pageNo}_` : ""}${name}"`,
    },
  });
});
