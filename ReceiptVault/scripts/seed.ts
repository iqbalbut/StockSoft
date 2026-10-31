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

if (!(await db.query.clients.findFirst())) await db.insert(schema.clients).values([{ name: "Acme Retail", code: "ACME" }, { name: "Brightwater Analytics Ltd", code: "BWA" }]);

for (const c of TEST_CASES) {
  const file = path.resolve(`fixtures/images/${c.id}.jpg`);
  if (!fs.existsSync(file)) {
    console.warn(`missing ${file}; run npm run fixtures`);
    continue;
  }
  const r = await ingest({ files: [{ name: c.filename, data: fs.readFileSync(file) }], source: "seed", sourceRef: c.id, actor: { type: "system", id: "seed" } });
  if (r.documents.length) await drainQueue(); // in order, so the duplicate sees its original
}
const counts = await db.select({ status: schema.documents.status }).from(schema.documents);
console.log("documents by status:", counts.reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {}));
process.exit(0);
