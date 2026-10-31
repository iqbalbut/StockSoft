import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type Doc = typeof schema.documents.$inferSelect;
export type ClientDoc = Doc & { files: { id: string; pageNo: number; mimeType: string }[] };

async function attachFiles(docs: Doc[]): Promise<ClientDoc[]> {
  if (!docs.length) return [];
  const db = await getDb();
  const files = await db
    .select({ id: schema.documentFiles.id, documentId: schema.documentFiles.documentId, pageNo: schema.documentFiles.pageNo, mimeType: schema.documentFiles.mimeType })
    .from(schema.documentFiles)
    .where(inArray(schema.documentFiles.documentId, docs.map((d) => d.id)))
    .orderBy(asc(schema.documentFiles.pageNo));
  return docs.map((d) => ({ ...d, rawExtraction: null, files: files.filter((f) => f.documentId === d.id).map(({ documentId: _, ...f }) => f) }));
}

export async function listDocuments(opts: { statuses?: string[]; q?: string; limit?: number; offset?: number; order?: "oldest" | "newest" }) {
  const db = await getDb();
  const where = and(
    opts.statuses?.length ? inArray(schema.documents.status, opts.statuses as Doc["status"][]) : undefined,
    opts.q
      ? or(
          ilike(schema.documents.vendorName, `%${opts.q}%`),
          ilike(schema.documents.originalFilename, `%${opts.q}%`),
          ilike(schema.documents.docNumber, `%${opts.q}%`),
        )
      : undefined,
  );
  const rows = await db.query.documents.findMany({
    where,
    orderBy: opts.order === "oldest" ? asc(schema.documents.createdAt) : desc(schema.documents.createdAt),
    limit: Math.min(opts.limit ?? 50, 200),
    offset: opts.offset ?? 0,
  });
  return attachFiles(rows);
}

export async function getDocument(id: string) {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, id) });
  if (!doc) return null;
  const [withFiles] = await attachFiles([doc]);
  const items = await db.query.lineItems.findMany({ where: eq(schema.lineItems.documentId, id), orderBy: asc(schema.lineItems.position) });
  const auditTrail = await db.query.auditLog.findMany({
    where: and(eq(schema.auditLog.entity, "document"), eq(schema.auditLog.entityId, id)),
    orderBy: desc(schema.auditLog.id),
    limit: 100,
  });
  return { ...withFiles, lineItems: items, auditTrail };
}

export async function statusCounts(batchId?: string) {
  const db = await getDb();
  const rows = await db
    .select({ status: schema.documents.status, n: sql<number>`count(*)::int` })
    .from(schema.documents)
    .where(batchId ? eq(schema.documents.batchId, batchId) : undefined)
    .groupBy(schema.documents.status);
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) as Record<string, number>;
}
