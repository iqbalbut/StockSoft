import { and, eq, lte, desc, gte } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { CURRENCIES } from "@/extraction/schema";

export type FxQuote = { perUsd: number; rateDate: string; source: string };
export type FxProvider = (currency: string, date: string) => Promise<FxQuote | null>;

const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);

/** Fetches the daily USD table for a date (free, no key, includes PKR and AED) and caches it. */
async function fetchDay(date: string): Promise<Record<string, number> | null> {
  const urls = [`${env().FX_API_BASE}@${date}/v1/currencies/usd.min.json`, `https://${date}.currency-api.pages.dev/v1/currencies/usd.min.json`];
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const body = (await res.json()) as { usd?: Record<string, number> };
      if (body.usd) return body.usd;
    } catch {
      // try the next mirror
    }
  }
  return null;
}

/**
 * Historical rate on the transaction date: cached DB row → remote daily table → the closest earlier cached
 * rate within 5 days (weekends/holidays). Returns null rather than guessing; the document then goes to review.
 */
export const defaultFxProvider: FxProvider = async (currency, date) => {
  if (currency === "USD") return { perUsd: 1, rateDate: date, source: "identity" };
  const db = await getDb();
  const cached = await db.query.fxRates.findFirst({
    where: and(eq(schema.fxRates.currency, currency), eq(schema.fxRates.rateDate, date)),
  });
  if (cached) return { perUsd: Number(cached.perUsd), rateDate: cached.rateDate, source: cached.source };

  const today = new Date().toISOString().slice(0, 10);
  if (date <= today) {
    const table = await fetchDay(date);
    if (table) {
      const wanted = new Set<string>([...CURRENCIES.filter((c) => c !== "USD"), currency]);
      const rows = [...wanted]
        .filter((c) => table[c.toLowerCase()])
        .map((c) => ({ rateDate: date, currency: c, perUsd: String(table[c.toLowerCase()]), source: "fawazahmed0/currency-api" }));
      if (rows.length) await db.insert(schema.fxRates).values(rows).onConflictDoNothing();
      const r = table[currency.toLowerCase()];
      if (r) return { perUsd: r, rateDate: date, source: "fawazahmed0/currency-api" };
    }
  }
  const near = await db.query.fxRates.findFirst({
    where: and(eq(schema.fxRates.currency, currency), lte(schema.fxRates.rateDate, date), gte(schema.fxRates.rateDate, addDays(date, -5))),
    orderBy: desc(schema.fxRates.rateDate),
  });
  return near ? { perUsd: Number(near.perUsd), rateDate: near.rateDate, source: `${near.source} (nearest)` } : null;
};

export const toUsd = (amount: number, q: FxQuote) => Math.round((amount / q.perUsd) * 100) / 100;
