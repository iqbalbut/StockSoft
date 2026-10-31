import { CATEGORIES, type Category } from "@/extraction/schema";

export const money = (v: string | number | null | undefined, currency?: string | null) => {
  if (v == null || v === "") return "—";
  const n = Number(v);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${n.toFixed(2)} ${currency ?? ""}`;
  }
};

export const categoryLabel = (c: string | null | undefined) => (c && c in CATEGORIES ? CATEGORIES[c as Category].label : c ?? "—");

export const STATUS_STYLE: Record<string, string> = {
  queued: "bg-slate-500/15 text-slate-500",
  processing: "bg-sky-500/15 text-sky-500",
  needs_review: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  approved: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  rejected: "bg-rose-500/15 text-rose-500",
  duplicate: "bg-violet-500/15 text-violet-500",
  failed: "bg-rose-500/15 text-rose-500",
};

export const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  processing: "Reading…",
  needs_review: "Needs review",
  approved: "Approved",
  rejected: "Rejected",
  duplicate: "Duplicate?",
  failed: "Failed",
};
