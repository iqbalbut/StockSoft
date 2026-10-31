// Runs the 10 test cases through the LIVE model and grades the output.
//   ANTHROPIC_API_KEY=... npm run eval:extraction
// Key metric: "silent errors" = wrong values the model was ≥90% confident about (those would be
// auto-approved without review). That number must be 0; low-confidence mistakes are fine (they get reviewed).
import fs from "node:fs";
import path from "node:path";
import { TEST_CASES } from "../src/extraction/test-cases";
import { extractDocument, extractionMode } from "../src/extraction/extract";
import { normalizeVendor } from "../src/pipeline/naming";

if (extractionMode() !== "claude") {
  console.error("Set ANTHROPIC_API_KEY to run the live extraction eval (estimated $0.30–0.80 for all 10 cases).");
  process.exit(1);
}

const CONF_KEY: Record<string, string> = { document_date: "document_date", vendor_name: "vendor_name" };
const only = process.argv[2];
const rows: Record<string, unknown>[] = [];
let fields = 0, correct = 0, silent = 0;

for (const c of TEST_CASES.filter((c) => !only || c.id.startsWith(only))) {
  const file = ["jpg", "png", "pdf"].map((e) => path.resolve(`fixtures/images/${c.id}.${e}`)).find(fs.existsSync);
  if (!file) {
    console.warn(`skip ${c.id}: no image (run npm run fixtures)`);
    continue;
  }
  const mime = file.endsWith(".pdf") ? "application/pdf" : file.endsWith(".png") ? "image/png" : "image/jpeg";
  const t0 = Date.now();
  const r = await extractDocument([{ mimeType: mime, data: fs.readFileSync(file) }], { filename: path.basename(file) });
  const x = r.extraction as unknown as Record<string, unknown>;
  const conf = r.extraction.confidence as Record<string, number>;
  const results: string[] = [];
  for (const [k, want] of Object.entries(c.expected)) {
    const got = x[k];
    const ok =
      k === "vendor_name"
        ? normalizeVendor(String(got ?? "")).includes(normalizeVendor(String(want))) || normalizeVendor(String(want)).includes(normalizeVendor(String(got ?? "")))
        : typeof want === "number"
          ? typeof got === "number" && Math.abs(got - want) < 0.011
          : got === want;
    fields++;
    if (ok) correct++;
    const cf = conf[CONF_KEY[k] ?? k] ?? 0;
    if (!ok && cf >= 0.9) silent++;
    results.push(`${ok ? "✓" : cf >= 0.9 ? "✗!" : "✗"} ${k}=${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)}, conf ${cf})`}`);
  }
  console.log(`\n${c.id} — ${c.title} [${((Date.now() - t0) / 1000).toFixed(1)}s, ${r.attempts} attempt(s), quality=${r.extraction.image_quality}]`);
  console.log("  " + results.join("\n  "));
  if (r.extraction.notes) console.log(`  notes: ${r.extraction.notes}`);
  rows.push({ id: c.id, extraction: r.extraction, usage: r.usage, results });
}

console.log(`\nField accuracy: ${correct}/${fields} (${((correct / Math.max(fields, 1)) * 100).toFixed(1)}%)`);
console.log(`Silent errors (wrong but ≥90% confident): ${silent} ${silent ? "← investigate: these would be auto-approved" : "✓"}`);
fs.writeFileSync("fixtures/eval-results.json", JSON.stringify({ at: new Date().toISOString(), correct, fields, silent, rows }, null, 2));
process.exit(silent ? 1 : 0);
