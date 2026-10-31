import crypto from "node:crypto";
import { CONFIDENCE_FIELDS, type Extraction } from "./schema";
import { TEST_CASES } from "./test-cases";

/**
 * Demo-mode extractor (no API key): returns the simulated response for a known test-case filename, or a
 * deterministic low-confidence placeholder so the document lands in the review queue. Never used when
 * ANTHROPIC_API_KEY is set.
 */
export function mockExtract(filename: string): Extraction {
  const known = TEST_CASES.find((c) => c.filename === filename || filename.startsWith(c.id));
  if (known) return structuredClone(known.simulated);

  const h = crypto.createHash("sha256").update(filename).digest();
  const total = Math.round((h.readUInt16BE(0) % 20000) + 100) / 10;
  return {
    document_type: "expense_receipt",
    issued_by_us: false,
    language: "en",
    image_quality: "fair",
    vendor_name: filename.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 40) || "Unknown vendor",
    vendor_tax_id: null,
    document_number: null,
    document_date: new Date(Date.now() - (h[2] % 60) * 86400_000).toISOString().slice(0, 10),
    due_date: null,
    currency: "USD",
    subtotal: null,
    tax: null,
    tip: null,
    total,
    payment_method: "unknown",
    card_last4: null,
    line_items: [],
    client_reference: null,
    category: "other",
    is_business: true,
    is_billable: false,
    confidence: Object.fromEntries(CONFIDENCE_FIELDS.map((f) => [f, 0.5])) as Extraction["confidence"],
    notes: "Demo mode: no ANTHROPIC_API_KEY set, so these values are placeholders. Edit them or add a key.",
  };
}
