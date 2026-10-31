import "./setup-env";
import { describe, it, expect } from "vitest";
import { archivedName, normalizeVendor } from "@/pipeline/naming";
import { maskSensitive, luhnValid } from "@/extraction/sanitize";
import { isFuzzyDuplicate } from "@/pipeline/duplicates";
import { totalsConsistent } from "@/pipeline/route";
import { ExtractionSchema, EXTRACTION_JSON_SCHEMA } from "@/extraction/schema";
import { TEST_CASES } from "@/extraction/test-cases";

describe("naming", () => {
  it("builds YYYY-MM-DD_Vendor_Amount_Currency.ext", () => {
    expect(archivedName({ docDate: "2026-09-14", vendorName: "Lahore Grill House", total: "5508.4", currency: "PKR" }, "jpg")).toBe(
      "2026-09-14_LahoreGrillHouse_5508.40_PKR.jpg",
    );
    expect(archivedName({ docDate: null, vendorName: null, total: null, currency: null }, "pdf")).toBe("0000-00-00_Unknown_0.00_XXX.pdf");
  });
  it("normalises vendor names across legal suffixes", () => {
    expect(normalizeVendor("NetLink Broadband (Pvt) Ltd")).toBe(normalizeVendor("Netlink Broadband"));
    expect(normalizeVendor("CloudNimbus, Inc.")).toBe("cloudnimbus");
  });
});

describe("sensitive data", () => {
  it("masks card numbers and IBANs but keeps phone numbers and invoice numbers", () => {
    expect(luhnValid("4111111111111111")).toBe(true);
    expect(maskSensitive("Paid with 4111 1111 1111 1111")).toBe("Paid with [card …1111]");
    expect(maskSensitive("IBAN PK36SCBL0000001123456702")).toContain("[IBAN …6702]");
    expect(maskSensitive("Call +92 300 1234567")).toBe("Call +92 300 1234567");
  });
});

describe("rules", () => {
  const s = { duplicateDayWindow: 3, duplicateAmountTolerancePct: 1 };
  const a = { id: "a", vendorKey: "lahore grill house", docDate: "2026-09-14", total: 5508.4, currency: "PKR", docNumber: null };
  it("flags near-identical vendor/date/amount as duplicates", () => {
    expect(isFuzzyDuplicate(a, { ...a, id: "b", docDate: "2026-09-15", total: 5510 }, s)).toBe(true);
    expect(isFuzzyDuplicate(a, { ...a, id: "b", docDate: "2026-09-20" }, s)).toBe(false);
    expect(isFuzzyDuplicate(a, { ...a, id: "b", total: 6000 }, s)).toBe(false);
    expect(isFuzzyDuplicate(a, { ...a, id: "b", vendorKey: "other" }, s)).toBe(false);
  });
  it("accepts tax-exclusive and tax-inclusive totals", () => {
    expect(totalsConsistent({ subtotal: 100, tax: 16, tip: 0, total: 116 })).toBe(true);
    expect(totalsConsistent({ subtotal: 684, tax: 114, tip: null, total: 684 })).toBe(true);
    expect(totalsConsistent({ subtotal: 100, tax: 16, tip: null, total: 150 })).toBe(false);
  });
});

describe("schema", () => {
  it("every simulated test-case response validates", () => {
    for (const c of TEST_CASES) expect(ExtractionSchema.safeParse(c.simulated).success, c.id).toBe(true);
  });
  it("JSON schema requires every property it declares", () => {
    expect([...EXTRACTION_JSON_SCHEMA.required].sort()).toEqual(Object.keys(EXTRACTION_JSON_SCHEMA.properties).sort());
  });
  it("rejects out-of-range confidence and malformed dates", () => {
    const bad = { ...TEST_CASES[0].simulated, document_date: "14/09/2026" };
    expect(ExtractionSchema.safeParse(bad).success).toBe(false);
    const bad2 = { ...TEST_CASES[0].simulated, confidence: { ...TEST_CASES[0].simulated.confidence, total: 1.4 } };
    expect(ExtractionSchema.safeParse(bad2).success).toBe(false);
  });
});
