import { and, eq, gte, inArray, sql, ne, asc, isNull, lte, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSettings } from "@/lib/settings";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mailer";
import { audit } from "@/lib/audit";
import { zonedDate } from "@/lib/schedule";
import { billsNeedingReminder } from "./payables";
import { emit } from "./events";

const d = schema.documents;
const fmtUsd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const fmt = (v: string | null, c: string | null) => (v == null ? "—" : `${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${c ?? ""}`);

async function recipient() {
  const s = await getSettings();
  if (s.digestEmail) return s.digestEmail;
  const db = await getDb();
  return (await db.query.users.findFirst({ where: eq(schema.users.role, "owner") }))?.email ?? null;
}

/** "X documents processed, Y need review, Z total claimable" for the 7 days before `now`. */
export async function buildDigest(now = new Date()) {
  const db = await getDb();
  const since = new Date(now.getTime() - 7 * 86400_000);
  const year = now.getUTCFullYear();
  const usd = sql<number>`coalesce(sum(${d.totalUsd}), 0)::float`;
  const n = sql<number>`count(*)::int`;
  const expense = and(eq(d.isBusiness, true), ne(d.docType, "sales_invoice"));

  const [processed] = await db.select({ n, usd }).from(d).where(and(gte(d.createdAt, since), inArray(d.status, ["approved", "needs_review", "duplicate", "rejected"])));
  const [auto] = await db.select({ n }).from(d).where(and(gte(d.createdAt, since), eq(d.autoApproved, true)));
  const [review] = await db.select({ n }).from(d).where(inArray(d.status, ["needs_review", "duplicate"]));
  const [claimable] = await db.select({ usd }).from(d).where(and(gte(d.createdAt, since), inArray(d.status, ["approved", "needs_review"]), expense));
  const [ytd] = await db.select({ usd }).from(d).where(and(eq(d.status, "approved"), expense, gte(d.docDate, `${year}-01-01`)));
  const [failed] = await db.select({ n }).from(d).where(eq(d.status, "failed"));
  const today = now.toISOString().slice(0, 10);
  const week = new Date(now.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
  const bills = await db.query.documents.findMany({
    where: and(eq(d.docType, "vendor_bill"), inArray(d.status, ["approved", "needs_review"]), isNull(d.paidAt), isNotNull(d.dueDate), lte(d.dueDate, week)),
    orderBy: asc(d.dueDate),
    limit: 10,
  });

  const data = {
    periodStart: since.toISOString().slice(0, 10),
    periodEnd: today,
    processed: processed.n,
    autoApproved: auto.n,
    needReview: review.n,
    failed: failed.n,
    claimableUsd: Math.round(claimable.usd * 100) / 100,
    claimedYtdUsd: Math.round(ytd.usd * 100) / 100,
    billsDue: bills.map((b) => ({ id: b.id, vendor: b.vendorName, total: b.total, currency: b.currency, dueDate: b.dueDate, overdue: (b.dueDate ?? "") < today })),
  };
  const headline = `${data.processed} documents processed, ${data.needReview} need review, ${fmtUsd(data.claimableUsd)} claimable`;
  const url = env().APP_URL;
  const text = [
    `ReceiptVault weekly digest (${data.periodStart} to ${data.periodEnd})`,
    "",
    headline + ".",
    `${data.autoApproved} were filed automatically. Claimed so far in ${year}: ${fmtUsd(data.claimedYtdUsd)}.`,
    data.failed ? `${data.failed} document(s) failed to read and need a retry.` : "",
    "",
    bills.length ? "Bills due in the next 7 days:" : "No bills due in the next 7 days.",
    ...data.billsDue.map((b) => `  • ${b.vendor}: ${fmt(b.total, b.currency)}, due ${b.dueDate}${b.overdue ? " (OVERDUE)" : ""}`),
    "",
    data.needReview ? `Review now: ${url}/review` : `Open: ${url}`,
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");
  return { data, headline, text };
}

export async function sendDigest(now = new Date()) {
  const { data, headline, text } = await buildDigest(now);
  const to = await recipient();
  const emailed = to ? await sendMail({ to, subject: `Receipts: ${headline}`, text }) : false;
  await emit("digest.weekly", { ...data, headline, text });
  await audit({ type: "system" }, "digest", data.periodEnd, "sent", { emailed, to, headline });
  return { emailed, headline };
}

/** Daily: email + webhook for bills due soon or overdue (once per bill per day). */
export async function sendReminders(now = new Date()) {
  const s = await getSettings();
  const today = zonedDate(now, s.timeZone);
  const bills = await billsNeedingReminder(today, s.reminderDaysBefore);
  if (!bills.length) return 0;
  const to = await recipient();
  const lines = bills.map((b) => `• ${b.vendorName}: ${fmt(b.total, b.currency)}, due ${b.dueDate}${(b.dueDate ?? "") < today ? " (OVERDUE)" : ""}`);
  if (to) await sendMail({ to, subject: `${bills.length} bill${bills.length === 1 ? "" : "s"} due soon`, text: `${lines.join("\n")}\n\nMark as paid: ${env().APP_URL}/payables` });
  const db = await getDb();
  for (const b of bills) {
    await emit("bill.due_soon", { id: b.id, vendor: b.vendorName, total: b.total, currency: b.currency, dueDate: b.dueDate, overdue: (b.dueDate ?? "") < today });
    await db.update(d).set({ remindedAt: now }).where(eq(d.id, b.id));
  }
  return bills.length;
}
