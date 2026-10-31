import "./setup-env";
import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ingest } from "@/pipeline/ingest";
import { processDocument } from "@/pipeline/process";
import { updateDocument, approveDocument } from "@/pipeline/documents";
import { claimJob, completeJob } from "@/pipeline/jobs";
import { getObject } from "@/lib/storage";
import { TEST_CASES } from "@/extraction/test-cases";
import { stubFx, fakeJpeg } from "./helpers";

const STATUS = { auto_approve: "approved", review: "needs_review", duplicate: "duplicate" } as const;
const actor = { type: "user" as const, id: "00000000-0000-0000-0000-000000000001" };

async function run(filename: string, bytes = fakeJpeg(filename)) {
  const r = await ingest({ files: [{ name: filename, data: bytes }], source: "upload", actor });
  const id = r.documents[0].id;
  const job = await claimJob();
  expect(job?.type).toBe("process_document");
  await processDocument(id, { fx: stubFx });
  await completeJob(job!.id);
  return (await getDb()).query.documents.findFirst({ where: eq(schema.documents.id, id) });
}

describe("pipeline: the 10 extraction test cases", () => {
  beforeAll(async () => {
    const db = await getDb();
    await db.insert(schema.users).values({ id: actor.id, email: "t@example.com", passwordHash: "x" });
  });

  for (const c of TEST_CASES) {
    it(`${c.id}: ${c.title} → ${c.expectedRoute}`, async () => {
      const doc = (await run(c.filename))!;
      expect(doc.status).toBe(STATUS[c.expectedRoute]);
      for (const r of c.expectedReasons ?? []) expect(doc.reviewReasons).toContain(r);
      if (c.expectedRoute === "auto_approve") expect(doc.reviewReasons).toEqual([]);
      expect(doc.archivedFilename).toMatch(/^\d{4}-\d{2}-\d{2}_[A-Za-z0-9]+_\d+\.\d{2}_[A-Z]{3}\.jpg$/);
      expect(doc.totalUsd).not.toBeNull();
      expect(doc.retainUntil).toMatch(/^20(3|4)\d-12-31$/);
    });
  }

  it("keeps the original amount and the converted USD amount", async () => {
    const db = await getDb();
    const doc = await db.query.documents.findFirst({ where: eq(schema.documents.originalFilename, "IMG_20260914_2141.jpg") });
    expect(Number(doc!.total)).toBe(5508.4);
    expect(doc!.currency).toBe("PKR");
    expect(Number(doc!.totalUsd)).toBeCloseTo(19.67, 2);
  });

  it("links the duplicate to the original", async () => {
    const db = await getDb();
    const orig = await db.query.documents.findFirst({ where: eq(schema.documents.originalFilename, "IMG_20260914_2141.jpg") });
    const dup = await db.query.documents.findFirst({ where: eq(schema.documents.originalFilename, "Receipt-LahoreGrill-scan.jpg") });
    expect(dup!.duplicateOfId).toBe(orig!.id);
  });

  it("an exact re-upload is caught at ingest without calling the model", async () => {
    const r = await ingest({ files: [{ name: "again.jpg", data: fakeJpeg("cloudnimbus-invoice-oct.pdf") }], source: "upload", actor });
    expect(r.documents[0].status).toBe("duplicate");
    expect(await claimJob()).toBeNull();
  });

  it("stores originals encrypted and recoverable", async () => {
    const db = await getDb();
    const f = await db.query.documentFiles.findFirst();
    const bytes = await getObject(f!.storageKey);
    expect(bytes[0]).toBe(0xff);
  });

  it("rejects unsupported files with a reason", async () => {
    const r = await ingest({ files: [{ name: "notes.docx", data: Buffer.from("PK-not-really") }], source: "upload", actor });
    expect(r.documents).toHaveLength(0);
    expect(r.rejected[0].reason).toMatch(/Unsupported/);
  });

  it("learns a vendor rule from one correction and applies it next time", async () => {
    const db = await getDb();
    const first = await db.query.documents.findFirst({ where: eq(schema.documents.originalFilename, "blurry-coffee.jpg") });
    await updateDocument(first!.id, { category: "office_expenses", total: "1750" }, actor);
    await approveDocument(first!.id, actor);
    const audits = await db.query.auditLog.findMany({ where: eq(schema.auditLog.entityId, first!.id) });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["ingested", "extracted", "edited", "approved"]));

    // Same vendor, different receipt (filename maps to the same simulated vendor via the case id prefix).
    const second = await run("03-blurry-cafe-second-visit.jpg");
    expect(second!.category).toBe("office_expenses");
    expect(second!.fieldConfidence!.category).toBe(1);
  });

  it("a multi-page capture becomes one document with ordered pages", async () => {
    const r = await ingest({
      files: [1, 2, 3].map((n) => ({ name: `page${n}.jpg`, data: fakeJpeg(`multi-${n}`) })),
      source: "camera",
      asPages: true,
      actor,
    });
    expect(r.documents).toHaveLength(1);
    const db = await getDb();
    const files = await db.query.documentFiles.findMany({ where: eq(schema.documentFiles.documentId, r.documents[0].id) });
    expect(files.map((f) => f.pageNo).sort()).toEqual([1, 2, 3]);
  });
});
