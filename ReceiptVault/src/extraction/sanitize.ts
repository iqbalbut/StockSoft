import type { Extraction } from "./schema";

// Defence in depth for "never store full card or bank account numbers": the prompt forbids them, and this
// masks any card number (13–19 digits, Luhn-valid) or IBAN that slips into free-text fields anyway.
const DIGIT_RUN = /\d(?:[ -]?\d){12,18}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g;

export function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function maskSensitive(s: string): string {
  return s
    .replace(IBAN, (m) => `[IBAN …${m.replace(/\s/g, "").slice(-4)}]`)
    .replace(DIGIT_RUN, (m) => {
      const digits = m.replace(/\D/g, "");
      return luhnValid(digits) ? `[card …${digits.slice(-4)}]` : m;
    });
}

export function sanitizeExtraction(x: Extraction): Extraction {
  const clean = (s: string | null) => (s == null ? s : maskSensitive(s));
  return {
    ...x,
    vendor_name: clean(x.vendor_name),
    client_reference: clean(x.client_reference),
    notes: clean(x.notes) ?? "",
    card_last4: x.card_last4 && /^\d{4}$/.test(x.card_last4) ? x.card_last4 : null,
    line_items: x.line_items.slice(0, 50).map((li) => ({ ...li, description: maskSensitive(li.description) })),
  };
}
