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
  /** cash: bills/invoices hit the ledger when paid (typical for a small LLC); accrual: on the document date. */
  accountingBasis: "cash" | "accrual";
  /** Weekly digest recipient (empty = owner's login email). */
  digestEmail: string;
  digestEnabled: boolean;
  /** Monday 09:00 in this time zone. */
  timeZone: string;
  /** Remind about unpaid bills this many days before they're due (and daily once overdue). */
  reminderDaysBefore: number;
  // Invoicing
  companyAddress: string;
  companyEmail: string;
  paymentInstructions: string;
  invoicePrefix: string;
  invoiceDueDays: number;
  /** Category → chart-of-accounts code for Xero/QuickBooks exports. */
  accountCodes: Record<string, string>;
};

export const DEFAULT_SETTINGS: AppSettings = {
  autoApproveConfidence: 0.9,
  reviewAmountUsd: 500,
  retentionYears: 7,
  duplicateDayWindow: 3,
  duplicateAmountTolerancePct: 1,
  companyName: "AiNetworks LLC",
  accountingBasis: "cash",
  digestEmail: "",
  digestEnabled: true,
  timeZone: "Asia/Karachi",
  reminderDaysBefore: 3,
  companyAddress: "30 N Gould St, Sheridan, WY 82801, USA",
  companyEmail: "",
  paymentInstructions: "",
  invoicePrefix: "AIN",
  invoiceDueDays: 30,
  // Xero's default chart of accounts; change to match your own.
  accountCodes: {
    advertising_marketing: "400",
    bank_fees: "404",
    professional_fees: "412",
    contractors: "412",
    meals: "420",
    shipping_postage: "425",
    other: "429",
    insurance: "433",
    taxes_licenses: "429",
    utilities: "445",
    vehicle: "449",
    office_expenses: "453",
    supplies: "461",
    rent_lease: "469",
    repairs_maintenance: "473",
    software_saas: "485",
    dues_subscriptions: "485",
    education_training: "429",
    telecom_internet: "489",
    travel: "494",
    equipment: "710",
    revenue: "200",
  },
};

export async function getSettings(): Promise<AppSettings> {
  const db = await getDb();
  const row = await db.query.settings.findFirst({ where: eq(schema.settings.key, "app") });
  const saved = (row?.value as Partial<AppSettings>) ?? {};
  return { ...DEFAULT_SETTINGS, ...saved, accountCodes: { ...DEFAULT_SETTINGS.accountCodes, ...(saved.accountCodes ?? {}) } };
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
