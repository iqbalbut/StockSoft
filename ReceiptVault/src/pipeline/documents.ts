import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, diff, type Actor } from "@/lib/audit";
import { CATEGORY_KEYS, DOC_TYPES, PAYMENT_METHODS } from "@/extraction/schema";
import { getSettings } from "@/lib/settings";
import { defaultFxProvider, toUsd } from "./fx";
import { archivedName, extForMime, normalizeVendor } from "./naming";
import { enqueue } from "./jobs";
import { retainUntil } from "./process";

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable();
const moneyStr = z
  .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/), z.null()])
  .transform((v) => (v == null || v === "" ? null : String(v)));

/** Fields a reviewer may edit. Anything else (hashes, storage keys, audit) is immutable. */
export const DocumentPatch = z
  .object({
    docType: z.enum(DOC_TYPES),
    vendorName: z.string().max(200).nullable(),
    vendorTaxId: z.string().max(100).nullable(),
    docNumber: z.string().max(100).nullable(),
    docDate: dateStr,
    dueDate: dateStr,
    currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
    subtotal: moneyStr,
    tax: moneyStr,
    tip: moneyStr,
    total: moneyStr,
    paymentMethod: z.enum(PAYMENT_METHODS),
    cardLast4: z.string().regex(/^\d{4}$/).nullable(),
    category: z.enum(CATEGORY_KEYS),
    isBusiness: z.boolean(),
    isBillable: z.boolean(),
    clientRef: z.string().max(200).nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .partial()
  .strict();
export type DocumentPatch = z.infer<typeof DocumentPatch>;

async function load(id: string) {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, id) });
  if (!doc) throw new Error("Document not found");
  return doc;
}

/** Applies a reviewer's edit, keeping a field-level audit trail and learning vendor rules. */
export async function updateDocument(id: string, patch: DocumentPatch, actor: Actor & { id: string }) {
  const db = await getDb();
  const before = await load(id);
  const next = { ...before, ...patch };
  const extra: Partial<typeof schema.documents.$inferInsert> = {};

  if (patch.vendorName !== undefined) {
    const key = normalizeVendor(patch.vendorName);
    if (key && patch.vendorName) {
      await db.insert(schema.vendors).values({ name: patch.vendorName, normalizedName: key }).onConflictDoNothing();
      const v = await db.query.vendors.findFirst({ where: eq(schema.vendors.normalizedName, key) });
      extra.vendorId = v?.id ?? null;
    } else extra.vendorId = null;
  }

  if (patch.currency !== undefined || patch.docDate !== undefined || patch.total !== undefined) {
    const fx = next.currency && next.docDate && next.total != null ? await defaultFxProvider(next.currency, next.docDate) : null;
    extra.fxRate = fx ? String(fx.perUsd) : null;
    extra.fxDate = fx?.rateDate ?? null;
    extra.totalUsd = fx && next.total != null ? String(toUsd(Number(next.total), fx)) : null;
    const reasons = (before.reviewReasons ?? []).filter((r) => r !== "fx_unavailable");
    extra.reviewReasons = fx || next.total == null ? reasons : [...reasons, "fx_unavailable"];
  }

  const file = await db.query.documentFiles.findFirst({ where: eq(schema.documentFiles.documentId, id) });
  extra.archivedFilename = archivedName(next, extForMime(file?.mimeType ?? ""));
  if (patch.docDate !== undefined) extra.retainUntil = retainUntil(next.docDate, (await getSettings()).retentionYears);

  // A human-confirmed value is certain.
  const fieldConfidence = { ...(before.fieldConfidence ?? {}) };
  const confKey: Record<string, string> = { docType: "document_type", vendorName: "vendor_name", docDate: "document_date", total: "total", currency: "currency", category: "category", isBusiness: "is_business", isBillable: "is_billable", tax: "tax", dueDate: "due_date" };
  for (const k of Object.keys(patch)) if (confKey[k]) fieldConfidence[confKey[k]] = 1;

  const update = { ...patch, ...extra, fieldConfidence, updatedAt: new Date() };
  await db.update(schema.documents).set(update).where(eq(schema.documents.id, id));
  await audit(actor, "document", id, "edited", diff(before as Record<string, unknown>, { ...patch, ...extra }));

  // Learn: correcting category / business flag once applies it to this vendor going forward.
  const vendorId = extra.vendorId ?? before.vendorId;
  const learn: Partial<typeof schema.vendors.$inferInsert> = {};
  if (patch.category && patch.category !== before.category && next.docType !== "sales_invoice") learn.defaultCategory = patch.category;
  if (patch.isBusiness !== undefined && patch.isBusiness !== before.isBusiness) learn.defaultIsBusiness = patch.isBusiness;
  if (vendorId && Object.keys(learn).length) {
    await db.update(schema.vendors).set(learn).where(eq(schema.vendors.id, vendorId));
    await audit(actor, "vendor", vendorId, "rule_learned", learn);
  }
  return load(id);
}

export async function approveDocument(id: string, actor: Actor & { id: string }) {
  const db = await getDb();
  const doc = await load(id);
  if (doc.status === "approved") return doc;
  if (doc.total == null || !doc.currency || !doc.docDate) throw new Error("Date, currency and total are required before approving");
  await db
    .update(schema.documents)
    .set({ status: "approved", approvedBy: actor.id, approvedAt: new Date(), autoApproved: false, duplicateOfId: doc.status === "duplicate" ? null : doc.duplicateOfId, updatedAt: new Date() })
    .where(eq(schema.documents.id, id));
  await audit(actor, "document", id, "approved", { previousStatus: doc.status });
  return load(id);
}

export async function rejectDocument(id: string, actor: Actor & { id: string }, reason?: string) {
  const db = await getDb();
  const doc = await load(id);
  await db.update(schema.documents).set({ status: "rejected", updatedAt: new Date() }).where(eq(schema.documents.id, id));
  await audit(actor, "document", id, "rejected", { previousStatus: doc.status, reason: reason ?? null });
  return load(id);
}

export async function reprocessDocument(id: string, actor: Actor & { id: string }) {
  const db = await getDb();
  await db.update(schema.documents).set({ status: "queued", error: null, updatedAt: new Date() }).where(eq(schema.documents.id, id));
  await audit(actor, "document", id, "reprocess_requested");
  await enqueue("process_document", { documentId: id });
}
