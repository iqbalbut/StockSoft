import { CRITICAL_FIELDS, type Extraction } from "@/extraction/schema";
import type { AppSettings } from "@/lib/settings";

export type ReviewReason =
  | "low_confidence"
  | "amount_over_threshold"
  | "duplicate_suspected"
  | "fx_unavailable"
  | "totals_mismatch"
  | "missing_total"
  | "poor_image"
  | "personal_expense"
  | "manual_document_type";

export const REASON_LABELS: Record<ReviewReason, string> = {
  low_confidence: "Low confidence",
  amount_over_threshold: "Over amount limit",
  duplicate_suspected: "Possible duplicate",
  fx_unavailable: "No FX rate",
  totals_mismatch: "Totals don't add up",
  missing_total: "No total found",
  poor_image: "Poor image",
  personal_expense: "Looks personal",
  manual_document_type: "Needs filing",
};

export type RouteInput = {
  extraction: Extraction;
  /** Confidence after vendor rules are applied (learned fields are 1.0). */
  confidence: Record<string, number>;
  totalUsd: number | null;
  duplicateOf: string | null;
  settings: AppSettings;
};

export type RouteDecision = {
  status: "approved" | "needs_review" | "duplicate";
  reasons: ReviewReason[];
  overall: number;
  lowFields: string[];
};

export function totalsConsistent(x: Pick<Extraction, "subtotal" | "tax" | "tip" | "total">): boolean {
  if (x.total == null || x.subtotal == null) return true; // nothing to cross-check
  const tol = Math.max(0.05, Math.abs(x.total) * 0.01);
  const tax = x.tax ?? 0;
  const tip = x.tip ?? 0;
  // Tax-exclusive (subtotal + tax + tip) or tax-inclusive (subtotal + tip, tax shown "incl.") layouts.
  return Math.abs(x.subtotal + tax + tip - x.total) <= tol || Math.abs(x.subtotal + tip - x.total) <= tol;
}

/**
 * The routing rule. Auto-approval requires EVERY critical field at or above the threshold and no other
 * flag. Anything uncertain is sent to a human instead of being guessed.
 */
export function decideRoute(input: RouteInput): RouteDecision {
  const { extraction: x, confidence, settings } = input;
  const reasons = new Set<ReviewReason>();

  const lowFields = CRITICAL_FIELDS.filter((f) => (confidence[f] ?? 0) < settings.autoApproveConfidence);
  if (x.due_date && (confidence.due_date ?? 0) < settings.autoApproveConfidence) lowFields.push("due_date");
  const overall = Math.min(...CRITICAL_FIELDS.map((f) => confidence[f] ?? 0));
  if (lowFields.length) reasons.add("low_confidence");

  if (x.total == null) reasons.add("missing_total");
  if (!totalsConsistent(x)) reasons.add("totals_mismatch");
  if (x.image_quality === "poor") reasons.add("poor_image");
  if (!x.is_business) reasons.add("personal_expense");
  if (["bank_statement", "contract", "other"].includes(x.document_type)) reasons.add("manual_document_type");
  if (x.total != null && x.currency && input.totalUsd == null) reasons.add("fx_unavailable");
  if (settings.reviewAmountUsd > 0 && input.totalUsd != null && Math.abs(input.totalUsd) > settings.reviewAmountUsd) {
    reasons.add("amount_over_threshold");
  }

  if (input.duplicateOf) {
    reasons.add("duplicate_suspected");
    return { status: "duplicate", reasons: [...reasons], overall, lowFields };
  }
  return { status: reasons.size ? "needs_review" : "approved", reasons: [...reasons], overall, lowFields };
}
