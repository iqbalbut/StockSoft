import { z } from "zod";
import { and, eq, sql, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { audit, diff, type Actor } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { CATEGORY_KEYS, type Extraction } from "@/extraction/schema";
import { decideRoute } from "./route";
import { syncLedger } from "./ledger";
import { emit } from "./events";

export const VendorRulePatch = z
  .object({
    defaultCategory: z.enum(CATEGORY_KEYS).nullable(),
    defaultIsBusiness: z.boolean().nullable(),
    defaultIsBillable: z.boolean().nullable(),
    defaultClientId: z.uuid().nullable(),
  })
  .partial()
  .strict();

export async function listVendorRules() {
  const db = await getDb();
  const counts = db
    .select({ vendorId: schema.documents.vendorId, n: sql<number>`count(*)::int`.as("n") })
    .from(schema.documents)
    .groupBy(schema.documents.vendorId)
    .as("counts");
  return db
    .select({
      id: schema.vendors.id,
      name: schema.vendors.name,
      defaultCategory: schema.vendors.defaultCategory,
      defaultIsBusiness: schema.vendors.defaultIsBusiness,
      defaultIsBillable: schema.vendors.defaultIsBillable,
      defaultClientId: schema.vendors.defaultClientId,
      documents: sql<number>`coalesce(${counts.n}, 0)`,
    })
    .from(schema.vendors)
    .leftJoin(counts, eq(counts.vendorId, schema.vendors.id))
    .orderBy(sql`coalesce(${counts.n}, 0) desc`, schema.vendors.name);
}

/** Re-evaluates the routing rule for a document in review using its current (possibly edited) fields. */
export async function reroute(documentId: string) {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
  if (!doc || doc.status !== "needs_review" || !doc.rawExtraction) return doc?.status;
  const raw = doc.rawExtraction as Extraction;
  const x: Extraction = {
    ...raw,
    document_type: (doc.docType ?? raw.document_type) as Extraction["document_type"],
    vendor_name: doc.vendorName,
    document_date: doc.docDate,
    currency: doc.currency,
    total: doc.total == null ? null : Number(doc.total),
    subtotal: doc.subtotal == null ? null : Number(doc.subtotal),
    tax: doc.tax == null ? null : Number(doc.tax),
    tip: doc.tip == null ? null : Number(doc.tip),
    category: (doc.category ?? raw.category) as Extraction["category"],
    is_business: doc.isBusiness ?? raw.is_business,
    is_billable: doc.isBillable ?? raw.is_billable,
  };
  const decision = decideRoute({
    extraction: x,
    confidence: doc.fieldConfidence ?? raw.confidence,
    totalUsd: doc.totalUsd == null ? null : Number(doc.totalUsd),
    duplicateOf: null,
    settings: await getSettings(),
  });
  if (decision.status === doc.status && JSON.stringify(decision.reasons) === JSON.stringify(doc.reviewReasons)) return doc.status;
  const approved = decision.status === "approved";
  await db
    .update(schema.documents)
    .set({ status: decision.status, reviewReasons: decision.reasons, overallConfidence: decision.overall, autoApproved: approved, approvedAt: approved ? new Date() : null, updatedAt: new Date() })
    .where(eq(schema.documents.id, documentId));
  await audit({ type: "system" }, "document", documentId, approved ? "auto_approved" : "rerouted", { reasons: decision.reasons });
  if (approved) {
    await syncLedger(documentId);
    await emit("document.approved", { id: documentId, auto: true, vendor: doc.vendorName, total: doc.total, currency: doc.currency });
  }
  return decision.status;
}

/** Saves a vendor rule and applies it to that vendor's documents still waiting in review. */
export async function saveVendorRule(vendorId: string, patch: z.infer<typeof VendorRulePatch>, actor: Actor) {
  const db = await getDb();
  const before = await db.query.vendors.findFirst({ where: eq(schema.vendors.id, vendorId) });
  if (!before) throw new Error("Vendor not found");
  await db.update(schema.vendors).set(patch).where(eq(schema.vendors.id, vendorId));
  await audit(actor, "vendor", vendorId, "rule_updated", diff(before as Record<string, unknown>, patch));

  const open = await db.query.documents.findMany({
    where: and(eq(schema.documents.vendorId, vendorId), inArray(schema.documents.status, ["needs_review"])),
  });
  let rerouted = 0;
  for (const doc of open) {
    const set: Partial<typeof schema.documents.$inferInsert> = {};
    const conf = { ...(doc.fieldConfidence ?? {}) };
    if (patch.defaultCategory && doc.docType !== "sales_invoice") (set.category = patch.defaultCategory), (conf.category = 1);
    if (patch.defaultIsBusiness != null) (set.isBusiness = patch.defaultIsBusiness), (conf.is_business = 1);
    if (patch.defaultIsBillable != null) (set.isBillable = patch.defaultIsBillable), (conf.is_billable = 1);
    if (patch.defaultClientId) set.clientId = patch.defaultClientId;
    if (!Object.keys(set).length) continue;
    await db.update(schema.documents).set({ ...set, fieldConfidence: conf, updatedAt: new Date() }).where(eq(schema.documents.id, doc.id));
    await audit(actor, "document", doc.id, "vendor_rule_applied", set);
    if ((await reroute(doc.id)) === "approved") rerouted++;
  }
  return { applied: open.length, autoApproved: rerouted };
}
