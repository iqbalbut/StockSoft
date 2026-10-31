import { eq, asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getObject } from "@/lib/storage";
import { audit } from "@/lib/audit";
import { getSettings } from "@/lib/settings";
import { extractDocument, PermanentExtractionError, type ExtractionResult } from "@/extraction/extract";
import type { Extraction } from "@/extraction/schema";
import { decideRoute } from "./route";
import { findDuplicate } from "./duplicates";
import { defaultFxProvider, toUsd, type FxProvider, type FxQuote } from "./fx";
import { normalizeVendor, archivedName, extForMime } from "./naming";
import { matchClient } from "./clients";
import { syncLedger } from "./ledger";
import { emit } from "./events";

const num = (v: number | null) => (v == null ? null : String(v));

export function retainUntil(docDate: string | null, years: number) {
  const y = docDate ? Number(docDate.slice(0, 4)) : new Date().getFullYear();
  return `${y + years}-12-31`;
}

/** Finds or creates the vendor, returning any learned defaults. */
async function resolveVendor(x: Extraction) {
  const key = normalizeVendor(x.vendor_name);
  if (!key || !x.vendor_name) return null;
  const db = await getDb();
  const existing = await db.query.vendors.findFirst({ where: eq(schema.vendors.normalizedName, key) });
  if (existing) return existing;
  const [created] = await db
    .insert(schema.vendors)
    .values({ name: x.vendor_name, normalizedName: key, taxId: x.vendor_tax_id })
    .onConflictDoNothing()
    .returning();
  return created ?? (await db.query.vendors.findFirst({ where: eq(schema.vendors.normalizedName, key) }))!;
}

export async function loadPages(documentId: string) {
  const db = await getDb();
  const files = await db.query.documentFiles.findMany({
    where: eq(schema.documentFiles.documentId, documentId),
    orderBy: asc(schema.documentFiles.pageNo),
  });
  return Promise.all(files.map(async (f) => ({ mimeType: f.mimeType, data: await getObject(f.storageKey) })));
}

type Deps = { fx?: FxProvider };

/** Real-time path: extract now, then apply. */
export async function processDocument(documentId: string, deps: Deps = {}) {
  const db = await getDb();
  const doc = await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) });
  if (!doc) throw new PermanentExtractionError(`Document ${documentId} not found`);
  if (!["queued", "processing", "failed"].includes(doc.status)) return doc.status; // already handled

  await db.update(schema.documents).set({ status: "processing", updatedAt: new Date() }).where(eq(schema.documents.id, documentId));
  const result = await extractDocument(await loadPages(documentId), { filename: doc.originalFilename });
  return applyExtraction(documentId, result, deps);
}

/** Apply vendor rules → match client → convert currency → check duplicates → route → post. */
export async function applyExtraction(documentId: string, result: ExtractionResult, deps: Deps = {}) {
  const db = await getDb();
  const doc = (await db.query.documents.findFirst({ where: eq(schema.documents.id, documentId) }))!;
  const files = await db.query.documentFiles.findMany({ where: eq(schema.documentFiles.documentId, documentId), orderBy: asc(schema.documentFiles.pageNo) });
  const x = result.extraction;
  const settings = await getSettings();
  const confidence: Record<string, number> = { ...x.confidence };

  // Learned vendor rules: a correction made once applies to this vendor from then on.
  const vendor = await resolveVendor(x);
  let category = x.category;
  let isBusiness = x.is_business;
  let clientId: string | null = null;
  const applied: string[] = [];
  if (vendor?.defaultCategory && x.document_type !== "sales_invoice") {
    if (vendor.defaultCategory !== category) applied.push(`category: ${category} → ${vendor.defaultCategory}`);
    category = vendor.defaultCategory as Extraction["category"];
    confidence.category = 1;
  }
  if (vendor?.defaultIsBusiness != null) {
    isBusiness = vendor.defaultIsBusiness;
    confidence.is_business = 1;
  }
  let isBillable = x.is_billable;
  if (vendor?.defaultIsBillable != null) {
    isBillable = vendor.defaultIsBillable;
    confidence.is_billable = 1;
  }
  // Client: the vendor's default client, else the client/project reference printed on the document.
  clientId = vendor?.defaultClientId ?? null;
  if (!clientId && x.client_reference) {
    const clients = await db.query.clients.findMany({ columns: { id: true, name: true, code: true } });
    clientId = matchClient(x.client_reference, clients)?.id ?? null;
  }

  // Historical FX on the transaction date; original amounts are always kept.
  let fx: FxQuote | null = null;
  if (x.total != null && x.currency && x.document_date) {
    fx = await (deps.fx ?? defaultFxProvider)(x.currency, x.document_date);
  }
  const totalUsd = fx && x.total != null ? toUsd(x.total, fx) : null;

  const duplicateOf = await findDuplicate(
    {
      id: doc.id,
      sha256: doc.sha256,
      createdAt: doc.createdAt,
      vendorId: vendor?.id ?? null,
      vendorKey: normalizeVendor(x.vendor_name),
      docDate: x.document_date,
      total: x.total,
      currency: x.currency,
      docNumber: x.document_number,
    },
    settings,
  );

  const decision = decideRoute({ extraction: { ...x, category, is_business: isBusiness, is_billable: isBillable }, confidence, totalUsd, duplicateOf, settings });
  const fields = {
    docType: x.document_type,
    vendorId: vendor?.id ?? null,
    vendorName: x.vendor_name,
    vendorTaxId: x.vendor_tax_id,
    docNumber: x.document_number,
    docDate: x.document_date,
    dueDate: x.due_date,
    currency: x.currency,
    subtotal: num(x.subtotal),
    tax: num(x.tax),
    tip: num(x.tip),
    total: num(x.total),
    paymentMethod: x.payment_method,
    cardLast4: x.card_last4,
    category,
    isBusiness,
    isBillable,
    clientRef: x.client_reference,
    clientId,
    language: x.language,
    notes: x.notes || null,
    fxRate: fx ? String(fx.perUsd) : null,
    fxDate: fx?.rateDate ?? null,
    totalUsd: num(totalUsd),
  };
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(schema.documents)
      .set({
        ...fields,
        status: decision.status,
        reviewReasons: decision.reasons,
        fieldConfidence: confidence,
        overallConfidence: decision.overall,
        duplicateOfId: duplicateOf,
        rawExtraction: x,
        extractionModel: result.viaBatch ? `${result.model} (batch)` : result.model,
        error: null,
        archivedFilename: archivedName({ docDate: x.document_date, vendorName: x.vendor_name, total: x.total, currency: x.currency }, extForMime(files[0]?.mimeType ?? "")),
        retainUntil: retainUntil(x.document_date, settings.retentionYears),
        autoApproved: decision.status === "approved",
        approvedAt: decision.status === "approved" ? now : null,
        updatedAt: now,
      })
      .where(eq(schema.documents.id, documentId));
    await tx.delete(schema.lineItems).where(eq(schema.lineItems.documentId, documentId));
    if (x.line_items.length) {
      await tx.insert(schema.lineItems).values(
        x.line_items.map((li, i) => ({
          documentId,
          position: i + 1,
          description: li.description,
          quantity: num(li.quantity),
          unitPrice: num(li.unit_price),
          amount: num(li.amount),
        })),
      );
    }
  });

  await audit({ type: "ai", id: result.model }, "document", documentId, "extracted", {
    attempts: result.attempts,
    usage: result.usage,
    overallConfidence: decision.overall,
    lowFields: decision.lowFields,
    vendorRulesApplied: applied,
  });
  await audit({ type: "system" }, "document", documentId, decision.status === "approved" ? "auto_approved" : `routed_${decision.status}`, {
    reasons: decision.reasons,
    threshold: settings.autoApproveConfidence,
  });
  if (decision.status === "approved") await syncLedger(documentId);
  await emit("document.processed", { id: documentId, status: decision.status, reasons: decision.reasons, vendor: x.vendor_name, total: x.total, currency: x.currency, totalUsd });
  if (decision.status === "approved") await emit("document.approved", { id: documentId, auto: true, vendor: x.vendor_name, total: x.total, currency: x.currency, totalUsd });
  if (decision.status === "needs_review") await emit("document.needs_review", { id: documentId, reasons: decision.reasons, vendor: x.vendor_name });
  return decision.status;
}

export async function markFailed(documentId: string, error: string) {
  const db = await getDb();
  await db
    .update(schema.documents)
    .set({ status: "failed", error: error.slice(0, 1000), updatedAt: new Date() })
    .where(eq(schema.documents.id, documentId));
  await audit({ type: "system" }, "document", documentId, "failed", { error: error.slice(0, 500) });
}
