import crypto from "node:crypto";
import type { FxProvider } from "@/pipeline/fx";

/** Fixed rates (units per USD) so tests are deterministic and offline. */
export const RATES: Record<string, number> = { USD: 1, PKR: 280, AED: 3.6725, GBP: 0.75, EUR: 0.86 };
export const stubFx: FxProvider = async (currency, date) =>
  RATES[currency] ? { perUsd: RATES[currency], rateDate: date, source: "test" } : null;

/** Unique bytes with a JPEG signature (the mock extractor never decodes them). */
export const fakeJpeg = (seed: string) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.createHash("sha256").update(seed).digest()]);
