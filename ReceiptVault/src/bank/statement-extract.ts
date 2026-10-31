import { z } from "zod";
import { env } from "@/lib/env";
import { extractionMode, getClient, PermanentExtractionError } from "@/extraction/extract";
import { maskSensitive } from "@/extraction/sanitize";
import type { ParsedTxn } from "./csv";

const SYSTEM = `You read bank and credit-card statements (PDF or photo) for AiNetworks LLC and return every transaction as JSON. Statements may be from US, Pakistani, UAE or UK banks, in English or Urdu.
- date: posting/transaction date as YYYY-MM-DD. Use the statement period and the bank's country to resolve day/month order.
- description: the merchant/narration text as printed, single line.
- amount: money OUT of the account is negative, money IN is positive. For a credit-card statement, purchases are negative and payments/refunds positive. No thousands separators.
- Skip opening/closing balance lines, subtotals and running-balance columns.
- account_last4: only the last 4 digits of the account or card number. Never output a full account, card or IBAN number.
- currency: ISO 4217 of the account.
Return all transactions; if you cannot read some, set complete=false and say why in notes.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bank_name", "account_last4", "currency", "period_start", "period_end", "transactions", "complete", "notes"],
  properties: {
    bank_name: { type: ["string", "null"] },
    account_last4: { type: ["string", "null"] },
    currency: { type: "string" },
    period_start: { type: ["string", "null"] },
    period_end: { type: ["string", "null"] },
    transactions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "description", "amount"],
        properties: { date: { type: "string" }, description: { type: "string" }, amount: { type: "number" } },
      },
    },
    complete: { type: "boolean" },
    notes: { type: "string" },
  },
} as const;

const Result = z.object({
  bank_name: z.string().nullable(),
  account_last4: z.string().regex(/^\d{4}$/).nullable().catch(null),
  currency: z.string().regex(/^[A-Z]{3}$/),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null),
  transactions: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string(), amount: z.number() })),
  complete: z.boolean(),
  notes: z.string(),
});

export type StatementRead = { bankName: string | null; last4: string | null; currency: string; periodStart: string | null; periodEnd: string | null; transactions: ParsedTxn[]; complete: boolean; notes: string };

/** Reads a PDF/photo statement with Claude. CSV is preferred when the bank offers it (exact, free). */
export async function extractStatement(file: { mimeType: string; data: Buffer }): Promise<StatementRead> {
  if (extractionMode() !== "claude") throw new Error("Reading PDF statements needs ANTHROPIC_API_KEY. Export a CSV from your bank instead, or add the key.");
  const source =
    file.mimeType === "application/pdf"
      ? { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: file.data.toString("base64") } }
      : { type: "image" as const, source: { type: "base64" as const, media_type: file.mimeType as "image/jpeg", data: file.data.toString("base64") } };
  const e = env();
  const stream = getClient().beta.messages.stream({
    model: e.EXTRACTION_MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: e.EXTRACTION_EFFORT, format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
    system: SYSTEM,
    messages: [{ role: "user", content: [source, { type: "text", text: "Extract every transaction from this statement." }] }],
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new PermanentExtractionError("The model declined to read this statement.");
  if (msg.stop_reason === "max_tokens") throw new Error("Statement too long to read in one pass; split the PDF by month or use CSV.");
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const r = Result.parse(JSON.parse(text));
  return {
    bankName: r.bank_name,
    last4: r.account_last4,
    currency: r.currency,
    periodStart: r.period_start,
    periodEnd: r.period_end,
    transactions: r.transactions.filter((t) => t.amount !== 0).map((t) => ({ ...t, description: maskSensitive(t.description).slice(0, 300) })),
    complete: r.complete,
    notes: r.notes,
  };
}
