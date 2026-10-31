import { and, eq, ne, notInArray, gte, lte, lt, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { AppSettings } from "@/lib/settings";

export type DupCandidate = {
  id: string;
  vendorKey: string;
  docDate: string | null;
  total: number | null;
  currency: string | null;
  docNumber: string | null;
};

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400_000;

/** Fuzzy match: same vendor and currency, date within N days, amount within tolerance (or same doc number). */
export function isFuzzyDuplicate(a: DupCandidate, b: DupCandidate, s: Pick<AppSettings, "duplicateDayWindow" | "duplicateAmountTolerancePct">) {
  if (!a.vendorKey || a.vendorKey !== b.vendorKey) return false;
  if (a.docNumber && b.docNumber && a.docNumber.trim().toLowerCase() === b.docNumber.trim().toLowerCase()) return true;
  if (a.total == null || b.total == null || a.currency !== b.currency || !a.docDate || !b.docDate) return false;
  const tol = Math.max(0.01, (Math.abs(a.total) * s.duplicateAmountTolerancePct) / 100);
  return Math.abs(a.total - b.total) <= tol && dayDiff(a.docDate, b.docDate) <= s.duplicateDayWindow;
}

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

/** Looks for an earlier, non-rejected document that this one duplicates. */
export async function findDuplicate(doc: DupCandidate & { sha256: string; vendorId: string | null; createdAt: Date }, s: AppSettings): Promise<string | null> {
  const db = await getDb();
  // Only earlier documents count, so two copies processed concurrently can't flag each other.
  const live = and(
    notInArray(schema.documents.status, ["rejected", "duplicate", "failed"]),
    lt(schema.documents.createdAt, doc.createdAt),
  );
  const exact = await db.query.documents.findFirst({
    columns: { id: true },
    where: and(eq(schema.documents.sha256, doc.sha256), ne(schema.documents.id, doc.id), live),
  });
  if (exact) return exact.id;
  if (!doc.vendorId || !doc.docDate) return null;

  const window = s.duplicateDayWindow;
  const rows = await db.query.documents.findMany({
    columns: { id: true, docDate: true, total: true, currency: true, docNumber: true, createdAt: true },
    where: and(
      eq(schema.documents.vendorId, doc.vendorId),
      ne(schema.documents.id, doc.id),
      live,
      isNotNull(schema.documents.docDate),
      gte(schema.documents.docDate, addDays(doc.docDate, -window)),
      lte(schema.documents.docDate, addDays(doc.docDate, window)),
    ),
    limit: 25,
  });
  const hit = rows.find((r) =>
    isFuzzyDuplicate(doc, { id: r.id, vendorKey: doc.vendorKey, docDate: r.docDate, total: r.total == null ? null : Number(r.total), currency: r.currency, docNumber: r.docNumber }, s),
  );
  return hit?.id ?? null;
}
