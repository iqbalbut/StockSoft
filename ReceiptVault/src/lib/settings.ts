import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type AppSettings = {
  /** Every critical field must be at or above this to auto-approve. */
  autoApproveConfidence: number;
  /** Documents whose USD total exceeds this always go to review (0 = no limit). */
  reviewAmountUsd: number;
  /** Tax-record retention in years (IRS generally 3–7; we default to 7). */
  retentionYears: number;
  /** Fuzzy duplicate window. */
  duplicateDayWindow: number;
  duplicateAmountTolerancePct: number;
  companyName: string;
};

export const DEFAULT_SETTINGS: AppSettings = {
  autoApproveConfidence: 0.9,
  reviewAmountUsd: 500,
  retentionYears: 7,
  duplicateDayWindow: 3,
  duplicateAmountTolerancePct: 1,
  companyName: "AiNetworks LLC",
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "app") });
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
}

export async function saveSettings(patch: Partial<AppSettings>) {
  const db = await getDb();
  const value = { ...(await getSettings()), ...patch };
  await db
    .insert(schema.settings)
    .values({ key: "app", value })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedAt: new Date() } });
  return value;
}
