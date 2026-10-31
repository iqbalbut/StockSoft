// Demo data: owner account + the 10 test-case documents processed through the real pipeline.
//   npm run seed            (uses the mock extractor unless ANTHROPIC_API_KEY is set)
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../src/db";
import { hashPassword } from "../src/lib/crypto";
import { DEMO_USER } from "../src/lib/demo";
import { ingest } from "../src/pipeline/ingest";
import { drainQueue } from "../src/worker/worker";
import { TEST_CASES } from "../src/extraction/test-cases";

const db = await getDb();
let user = await db.query.users.findFirst({ where: eq(schema.users.email, DEMO_USER.email) });
if (!user) {
  [user] = await db.insert(schema.users).values({ email: DEMO_USER.email, name: "Demo CEO", passwordHash: hashPassword(DEMO_USER.password), role: "owner" }).returning();
  console.log(`created ${DEMO_USER.email} / ${DEMO_USER.password}`);
}

// Approximate USD rates for the demo dates, so the seed works offline. Real documents use the live
// historical-rate API; these rows are labelled as seed data.
const RATES = { PKR: 280.5, AED: 3.6725, GBP: 0.745, EUR: 0.86 };
const dates = new Set(TEST_CASES.map((c) => c.simulated.document_date).filter(Boolean) as string[]);
for (const d of dates)
  await db.insert(schema.fxRates).values(Object.entries(RATES).map(([currency, r]) => ({ rateDate: d, currency, perUsd: String(r), source: "seed (approximate)" }))).onConflictDoNothing();

if (!(await db.query.clients.findFirst()))
  await db.insert(schema.clients).values([
    { name: "Acme Retail", code: "ACME", email: "ap@acme.example" },
    { name: "Brightwater Analytics Ltd", code: "BWA", email: "finance@brightwater.example" },
  ]);

for (const c of TEST_CASES) {
  const file = path.resolve(`fixtures/images/${c.id}.jpg`);
  if (!fs.existsSync(file)) {
    console.warn(`missing ${file}; run npm run fixtures`);
    continue;
  }
  const r = await ingest({ files: [{ name: c.filename, data: fs.readFileSync(file) }], source: "seed", sourceRef: c.id, actor: { type: "system", id: "seed" } });
  if (r.documents.length) await drainQueue(); // in order, so the duplicate sees its original
}
// Phase 3 demo: two bank statements (auto-matched), invoice numbering continuing from AIN-2026-031, one draft invoice.
const { importStatement } = await import("../src/bank/import");
if (!(await db.query.statements.findFirst())) {
  for (const [file, currency, last4, dayFirst] of [["demo-meezan-pkr.csv", "PKR", "7710", true], ["demo-amex-usd.csv", "USD", "1009", false]] as const) {
    const r = await importStatement({ file: { name: file, data: fs.readFileSync(`fixtures/statements/${file}`) }, currency, accountLast4: last4, dayFirst, actor: { type: "system", id: "seed" } });
    console.log(`statement ${file}: ${r.imported} transactions, ${r.matched} matched, ${r.suggested} suggested`);
  }
}
await db.insert(schema.counters).values({ key: "invoice:AIN:2026", value: 31 }).onConflictDoNothing();
const bw = await db.query.clients.findFirst({ where: eq(schema.clients.code, "BWA") });
if (bw && !(await db.query.invoices.findFirst())) {
  const { createDraft } = await import("../src/invoices/invoices");
  await createDraft({ clientId: bw.id, currency: "GBP", taxRate: 0, notes: "Thank you for your business.", lines: [{ description: "AI chatbot integration (Phase 2)", quantity: 1, unitPrice: 2800 }, { description: "Support retainer, November", quantity: 10, unitPrice: 85 }] }, { type: "user", id: user!.id });
  console.log("draft invoice created for Brightwater Analytics");
}

const counts = await db.select({ status: schema.documents.status }).from(schema.documents);
console.log("documents by status:", counts.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}));
process.exit(0);
