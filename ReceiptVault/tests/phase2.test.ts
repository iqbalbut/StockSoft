import "./setup-env";
import fs from "node:fs";
import { describe, it, expect, beforeAll } from "vitest";
import nodemailer from "nodemailer";
import { and, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ingest } from "@/pipeline/ingest";
import { processDocument } from "@/pipeline/process";
import { approveDocument, rejectDocument, updateDocument } from "@/pipeline/documents";
import { markPaid } from "@/pipeline/payables";
import { saveVendorRule } from "@/pipeline/rules";
import { sendReminders, buildDigest, sendDigest } from "@/pipeline/notifications";
import { sign, deliverWebhook, emit } from "@/pipeline/events";
import { matchClient } from "@/pipeline/clients";
import { submitAiBatch, pollAiBatch } from "@/pipeline/ai-batch";
import { claimJob, completeJob } from "@/pipeline/jobs";
import { saveSettings } from "@/lib/settings";
import { setMailTransport } from "@/lib/mailer";
import { encryptString } from "@/lib/crypto";
import { resetEnvCache } from "@/lib/env";
import { lastOccurrence, lastDailyOccurrence } from "@/lib/schedule";
import { TEST_CASES } from "@/extraction/test-cases";
import { stubFx, fakeJpeg } from "./helpers";

const actor = { type: "user" as const, id: "00000000-0000-0000-0000-000000000002" };
const sent: { to: string; subject: string; text: string }[] = [];

async function drain() {
  for (;;) {
    const job = await claimJob();
    if (!job) return;
    if (job.type === "process_document") await processDocument((job.payload as { documentId: string }).documentId, { fx: stubFx });
    await completeJob(job.id);
  }
}

async function add(filename: string) {
  const r = await ingest({ files: [{ name: filename, data: fakeJpeg(filename + Math.random()) }], source: "upload", actor });
  await drain();
  const db = await getDb();
  return (await db.query.documents.findFirst({ where: eq(schema.documents.id, r.documents[0].id) }))!;
}

async function ledgerFor(id: string) {
  const db = await getDb();
  return db.query.ledgerEntries.findMany({ where: eq(schema.ledgerEntries.documentId, id), orderBy: (t, { asc }) => asc(t.id) });
}
const sum = (rows: { amount: string }[]) => rows.reduce((a, r) => a + Number(r.amount), 0);

beforeAll(async () => {
  const db = await getDb();
  await db.insert(schema.users).values({ id: actor.id, email: "owner@example.com", passwordHash: "x" });
  const t = nodemailer.createTransport({ jsonTransport: true });
  const orig = t.sendMail.bind(t);
  t.sendMail = ((m: { to: string; subject: string; text: string }) => {
    sent.push(m);
    return orig(m);
  }) as typeof t.sendMail;
  setMailTransport(t);
});

describe("ledger", () => {
  it("posts an auto-approved receipt once, reverses and reposts on edit, reverses on reject", async () => {
    const doc = await add("cloudnimbus-invoice-oct.pdf");
    expect(doc.status).toBe("approved");
    let rows = await ledgerFor(doc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "expense", category: "software_saas", currency: "USD", entryDate: "2026-10-01" });

    await updateDocument(doc.id, { notes: "nothing financial" }, actor);
    expect(await ledgerFor(doc.id)).toHaveLength(1); // no-op

    await updateDocument(doc.id, { total: "59" }, actor);
    rows = await ledgerFor(doc.id);
    expect(rows).toHaveLength(3); // original, reversal, new
    expect(sum(rows)).toBeCloseTo(59);
    expect(rows.filter((r) => !r.reversed)).toHaveLength(1);

    await rejectDocument(doc.id, actor);
    rows = await ledgerFor(doc.id);
    expect(sum(rows)).toBeCloseTo(0);
    expect(rows.filter((r) => !r.reversed)).toHaveLength(0);
  });

  it("cash basis: a vendor bill hits the ledger only when paid, on the paid date", async () => {
    const bill = await add("netlink-bill-sep-2026.pdf");
    expect(bill.status).toBe("approved");
    expect(await ledgerFor(bill.id)).toHaveLength(0);
    await markPaid(bill.id, { paidAt: "2026-10-18", paymentRef: "IBFT 7731" }, actor);
    const rows = await ledgerFor(bill.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entryDate: "2026-10-18", currency: "PKR" });
    expect(Number(rows[0].amount)).toBeCloseTo(8723.5);
    expect(Number(rows[0].amountUsd)).toBeCloseTo(31.16, 1);
  });

  it("accrual basis posts the bill on its document date", async () => {
    await saveSettings({ accountingBasis: "accrual" });
    const bill = await add("05-pkr-internet-bill-nov.pdf"); // same bill again → flagged duplicate
    expect(bill.status).toBe("duplicate");
    await approveDocument(bill.id, actor); // "it's a separate bill"
    const rows = await ledgerFor(bill.id);
    expect(rows[0]?.entryDate).toBe("2026-10-05");
    await saveSettings({ accountingBasis: "cash" });
  });

  it("personal expenses never post", async () => {
    const doc = await add("02-restaurant-pkr-personal.jpg");
    await updateDocument(doc.id, { isBusiness: false }, actor);
    await approveDocument(doc.id, actor);
    const rows = await ledgerFor(doc.id);
    expect(rows.filter((r) => !r.reversed)).toHaveLength(0);
  });
});

describe("clients and rules", () => {
  it("matches client references by code or distinctive name", () => {
    const clients = [
      { id: "1", name: "Acme Retail", code: "ACME" },
      { id: "2", name: "Brightwater Analytics Ltd", code: "BWA" },
    ];
    expect(matchClient("Acme Retail project", clients)?.id).toBe("1");
    expect(matchClient("PO BWA-114", clients)?.id).toBe("2");
    expect(matchClient("for brightwater", clients)?.id).toBe("2");
    expect(matchClient("misc", clients)).toBeNull();
  });

  it("links a handwritten 'Acme Retail project' receipt to the Acme client", async () => {
    const db = await getDb();
    const [acme] = await db.insert(schema.clients).values({ name: "Acme Retail", code: "ACME" }).returning();
    const doc = await add("handwritten-ali-design.jpg");
    expect(doc.clientId).toBe(acme.id);
    expect(doc.isBillable).toBe(true);
  });

  it("a vendor rule fills open review items and auto-approves the ones it resolves", async () => {
    const db = await getDb();
    const doc = await add("03-blurry-cafe-rule.jpg");
    expect(doc.status).toBe("needs_review");
    // Make category the only weak field, and remove the poor-image flag.
    const conf = Object.fromEntries(Object.keys(doc.fieldConfidence!).map((k) => [k, 0.98]));
    conf.category = 0.4;
    await db.update(schema.documents).set({ fieldConfidence: conf, rawExtraction: { ...(doc.rawExtraction as object), image_quality: "good" } }).where(eq(schema.documents.id, doc.id));
    const result = await saveVendorRule(doc.vendorId!, { defaultCategory: "meals", defaultIsBusiness: true }, actor);
    expect(result.autoApproved).toBe(1);
    const after = await db.query.documents.findFirst({ where: eq(schema.documents.id, doc.id) });
    expect(after!.status).toBe("approved");
    expect((await ledgerFor(doc.id)).length).toBe(1);
  });
});

describe("reminders, digest, webhooks", () => {
  it("reminds about bills due soon once per day, by email and webhook", async () => {
    const db = await getDb();
    await db.insert(schema.webhookEndpoints).values({ url: "https://n8n.example.com/hook", secret: encryptString("s3cret"), events: ["bill.due_soon", "digest.weekly"] });
    const bill = (await db.query.documents.findFirst({
      where: and(eq(schema.documents.docType, "vendor_bill"), eq(schema.documents.status, "approved"), isNull(schema.documents.paidAt)),
    }))!;
    await db.update(schema.documents).set({ dueDate: "2026-11-02" }).where(eq(schema.documents.id, bill.id));
    const now = new Date("2026-10-31T06:00:00Z"); // 11:00 in Karachi
    sent.length = 0;
    const n = await sendReminders(now);
    expect(n).toBeGreaterThanOrEqual(1);
    expect(sent[0].subject).toMatch(/due soon/);
    expect(await sendReminders(now)).toBe(0); // not twice the same day
    const jobs = await db.query.jobs.findMany({ where: and(eq(schema.jobs.type, "deliver_webhook"), eq(schema.jobs.status, "pending")) });
    expect(jobs.some((j) => (j.payload as { delivery: { event: string } }).delivery.event === "bill.due_soon")).toBe(true);
  });

  it("builds the weekly digest headline", async () => {
    const d = await buildDigest(new Date(Date.now() + 1000));
    expect(d.headline).toMatch(/^\d+ documents processed, \d+ need review, \$[\d,.]+ claimable$/);
    expect(d.data.processed).toBeGreaterThan(0);
    sent.length = 0;
    const r = await sendDigest();
    expect(r.emailed).toBe(true);
    expect(sent[0].to).toBe("owner@example.com");
  });

  it("signs deliveries with HMAC-SHA256 over timestamp.body", async () => {
    const db = await getDb();
    const ep = (await db.query.webhookEndpoints.findFirst())!;
    let captured: { headers: Record<string, string>; body: string } | null = null;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      captured = { headers: init.headers as Record<string, string>, body: init.body as string };
      return new Response("ok", { status: 200 });
    }) as unknown as typeof fetch;
    await deliverWebhook({ endpointId: ep.id, delivery: { id: "d1", event: "test", data: {} } }, fakeFetch);
    const ts = captured!.headers["x-receiptvault-timestamp"];
    expect(captured!.headers["x-receiptvault-signature"]).toBe(sign("s3cret", ts, captured!.body));
    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(deliverWebhook({ endpointId: ep.id, delivery: { id: "d2", event: "test", data: {} } }, failing)).rejects.toThrow(/500/);
  });

  it("only queues deliveries for subscribed events", async () => {
    const db = await getDb();
    const before = (await db.query.jobs.findMany({ where: eq(schema.jobs.type, "deliver_webhook") })).length;
    await emit("document.needs_review", { id: "x" });
    expect((await db.query.jobs.findMany({ where: eq(schema.jobs.type, "deliver_webhook") })).length).toBe(before);
  });

  it("schedules Monday 09:00 and daily 09:00 in Karachi time", () => {
    const tz = "Asia/Karachi";
    expect(lastOccurrence(new Date("2026-11-02T05:00:00Z"), tz, 1, 9).toISOString()).toBe("2026-11-02T04:00:00.000Z");
    expect(lastOccurrence(new Date("2026-11-02T03:00:00Z"), tz, 1, 9).toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(lastDailyOccurrence(new Date("2026-10-31T03:59:00Z"), tz, 9).toISOString()).toBe("2026-10-30T04:00:00.000Z");
  });
});

describe("economy mode (Message Batches API)", () => {
  it("submits queued economy documents in one batch and applies results, falling back on errors", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    resetEnvCache();
    try {
      const db = await getDb();
      const [batch] = await db.insert(schema.batches).values({ name: "economy", source: "upload" }).returning();
      const img = (id: string) => fs.readFileSync(`fixtures/images/${id}.jpg`);
      const r = await ingest({
        files: [{ name: "a.jpg", data: Buffer.concat([img("07-faded-thermal-aed"), Buffer.from("eco")]) }, { name: "b.jpg", data: Buffer.concat([img("09-sales-invoice-gbp"), Buffer.from("eco")]) }],
        source: "upload",
        economy: true,
        batchId: batch.id,
        actor,
      });
      const [a, b] = r.documents.map((d) => d.id);
      const submitJob = await db.query.jobs.findFirst({ where: and(eq(schema.jobs.type, "submit_ai_batch"), eq(schema.jobs.status, "pending")) });
      expect(submitJob).toBeTruthy();
      expect(await db.query.jobs.findFirst({ where: and(eq(schema.jobs.type, "process_document"), eq(schema.jobs.status, "pending")) })).toBeUndefined();

      let created: { requests: { custom_id: string; params: Record<string, unknown> }[] } | null = null;
      const sim = TEST_CASES.find((c) => c.id === "07-faded-thermal-aed")!.simulated;
      const fake = {
        create: async (p: never) => ((created = p), { id: "msgbatch_test" }),
        retrieve: async () => ({ processing_status: "ended" }),
        results: async () =>
          (async function* () {
            yield { custom_id: a, result: { type: "succeeded", message: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(sim) }], usage: { input_tokens: 1, output_tokens: 1 } } } };
            yield { custom_id: b, result: { type: "errored", error: {} } };
          })(),
      } as never;

      expect(await submitAiBatch(batch.id, fake)).toBe(2);
      expect(created!.requests.map((q) => q.custom_id).sort()).toEqual([a, b].sort());
      expect(created!.requests[0].params).not.toHaveProperty("fallbacks"); // not accepted by the Batches API
      expect(await pollAiBatch((await db.query.aiBatches.findFirst())!.id, fake, { fx: stubFx })).toBe(true);

      const docA = await db.query.documents.findFirst({ where: eq(schema.documents.id, a) });
      expect(docA!.status).toBe("approved");
      expect(docA!.extractionModel).toMatch(/batch/);
      const docB = await db.query.documents.findFirst({ where: eq(schema.documents.id, b) });
      expect(docB!.status).toBe("queued");
      expect(docB!.economy).toBe(false);
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
      resetEnvCache();
    }
  });
});
