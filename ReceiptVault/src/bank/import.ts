import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { getDb, schema } from "@/db";
import { putObject } from "@/lib/storage";
import { audit, type Actor } from "@/lib/audit";
import { sniffMime } from "@/pipeline/ingest";
import { readStatementCsv, type ParsedTxn } from "./csv";
import { extractStatement } from "./statement-extract";
import { runMatching } from "./match";

export type ImportResult = { statementId: string; imported: number; duplicates: number; skipped: number; matched: number; suggested: number; notes?: string };

export async function importStatement(opts: {
  file: { name: string; data: Buffer };
  name?: string;
  currency?: string;
  accountLast4?: string;
  dayFirst?: boolean;
  actor: Actor;
}): Promise<ImportResult> {
  const mime = sniffMime(opts.file.data, opts.file.name);
  const isCsv = /\.(csv|txt)$/i.test(opts.file.name) || (!mime && opts.file.data.subarray(0, 200).toString("utf8").includes(","));
  let txns: ParsedTxn[], currency = opts.currency ?? "USD", last4 = opts.accountLast4 ?? null, label: string | null = null, skipped = 0, notes: string | undefined;
  let periodStart: string | null = null, periodEnd: string | null = null;

  if (isCsv) {
    const r = readStatementCsv(opts.file.data.toString("utf8"), { dayFirst: opts.dayFirst ?? currency !== "USD" });
    txns = r.transactions;
    skipped = r.skipped;
  } else if (mime === "application/pdf" || mime?.startsWith("image/")) {
    const r = await extractStatement({ mimeType: mime, data: opts.file.data });
    txns = r.transactions;
    currency = opts.currency ?? r.currency;
    last4 = last4 ?? r.last4;
    label = r.bankName;
    periodStart = r.periodStart;
    periodEnd = r.periodEnd;
    if (!r.complete || r.notes) notes = r.notes;
  } else {
    throw new Error("Upload a CSV export, or a PDF/photo of the statement");
  }
  if (!txns.length) throw new Error("No transactions found in that file");
  const dates = txns.map((t) => t.date).sort();
  periodStart ??= dates[0];
  periodEnd ??= dates[dates.length - 1];

  const db = await getDb();
  const [st] = await db
    .insert(schema.statements)
    .values({
      name: opts.name || `${label ?? opts.file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ")} ${periodStart} – ${periodEnd}`,
      accountLabel: label,
      accountLast4: last4,
      currency,
      periodStart,
      periodEnd,
      sourceFormat: isCsv ? "csv" : "pdf",
      createdBy: opts.actor.type === "user" ? opts.actor.id : null,
    })
    .returning();
  const key = `statements/${st.id}/${isCsv ? "statement.csv" : mime === "application/pdf" ? "statement.pdf" : "statement.jpg"}`;
  await putObject(key, opts.file.data);
  await db.update(schema.statements).set({ storageKey: key }).where(eq(schema.statements.id, st.id));

  // Same account, date, amount and narration ⇒ same transaction, so overlapping statements don't double up.
  const account = last4 ?? currency;
  const seen = new Map<string, number>();
  const rows = txns.map((t) => {
    const base = `${account}|${t.date}|${t.amount.toFixed(2)}|${t.description.toLowerCase()}`;
    const n = (seen.get(base) ?? 0) + 1; // two identical coffees on the same day are both real
    seen.set(base, n);
    return { statementId: st.id, txnDate: t.date, description: t.description, amount: String(t.amount), currency, fingerprint: crypto.createHash("sha256").update(`${base}|${n}`).digest("hex") };
  });
  const inserted = await db.insert(schema.bankTransactions).values(rows).onConflictDoNothing().returning({ id: schema.bankTransactions.id });
  await audit(opts.actor, "statement", st.id, "imported", { transactions: inserted.length, duplicates: rows.length - inserted.length, skipped, format: isCsv ? "csv" : "pdf" });
  const m = await runMatching();
  return { statementId: st.id, imported: inserted.length, duplicates: rows.length - inserted.length, skipped, ...m, notes };
}

