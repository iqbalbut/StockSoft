import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { claimJob, completeJob, failJob, recoverStaleJobs, enqueue, type Job } from "@/pipeline/jobs";
import { processDocument, markFailed } from "@/pipeline/process";
import { PermanentExtractionError } from "@/extraction/extract";
import { pollGmail } from "@/ingest/gmail";
import { pollDrive } from "@/ingest/drive";
import { googleConfigured } from "@/ingest/google";
import { deliverWebhook } from "@/pipeline/events";
import { sendDigest, sendReminders } from "@/pipeline/notifications";
import { submitAiBatch, pollAiBatch } from "@/pipeline/ai-batch";
import { getSettings } from "@/lib/settings";
import { lastOccurrence, lastDailyOccurrence } from "@/lib/schedule";

async function run(job: Job) {
  const payload = job.payload as Record<string, string>;
  switch (job.type) {
    case "process_document":
      return processDocument(payload.documentId);
    case "deliver_webhook":
      return deliverWebhook(job.payload as Parameters<typeof deliverWebhook>[0]);
    case "send_digest":
      return sendDigest();
    case "send_reminders":
      return sendReminders();
    case "submit_ai_batch":
      return submitAiBatch(payload.batchId ?? null);
    case "poll_ai_batch":
      return pollAiBatch(payload.aiBatchId);
    case "poll_gmail":
      return pollGmail();
    case "poll_drive":
      return pollDrive();
    default:
      throw new PermanentExtractionError(`Unknown job type ${job.type}`);
  }
}

async function handle(job: Job) {
  try {
    await run(job);
    await completeJob(job.id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const dead = await failJob(job, msg, e instanceof PermanentExtractionError);
    console.error(`[worker] job ${job.id} (${job.type}) attempt ${job.attempts} failed${dead ? " permanently" : ""}: ${msg}`);
    if (job.type === "process_document") {
      const id = (job.payload as { documentId: string }).documentId;
      if (dead) await markFailed(id, msg);
      else await (await getDb()).update(schema.documents).set({ status: "queued", error: msg.slice(0, 1000) }).where(eq(schema.documents.id, id));
    }
  }
}

/** Schedules Gmail/Drive polls on the configured interval (one queued poll at a time per source). */
async function schedulePolls() {
  if (!googleConfigured()) return;
  const db = await getDb();
  const every = env().INGEST_POLL_MINUTES * 60_000;
  for (const source of ["gmail", "drive"] as const) {
    if (source === "drive" && !env().DRIVE_FOLDER_ID) continue;
    const state = await db.query.ingestState.findFirst({ where: eq(schema.ingestState.source, source) });
    if (state?.lastRunAt && Date.now() - state.lastRunAt.getTime() < every) continue;
    await db
      .insert(schema.ingestState)
      .values({ source, lastRunAt: new Date() })
      .onConflictDoUpdate({ target: schema.ingestState.source, set: { lastRunAt: new Date() } });
    await enqueue(source === "gmail" ? "poll_gmail" : "poll_drive", {}, { maxAttempts: 1 });
  }
}

/**
 * Runs a scheduled job once per occurrence. The first time a schedule is seen it is only initialised,
 * so a fresh install doesn't fire a digest immediately.
 */
async function once(key: string, dueAfter: Date, run: () => Promise<unknown>) {
  const db = await getDb();
  const state = await db.query.ingestState.findFirst({ where: eq(schema.ingestState.source, key) });
  if (state?.lastRunAt && state.lastRunAt >= dueAfter) return;
  await db
    .insert(schema.ingestState)
    .values({ source: key, lastRunAt: new Date() })
    .onConflictDoUpdate({ target: schema.ingestState.source, set: { lastRunAt: new Date() } });
  if (state) await run();
}

/** Weekly digest (Monday 09:00) and daily bill reminders (09:00) in the configured time zone. */
async function scheduleNotifications() {
  const s = await getSettings();
  const now = new Date();
  if (s.digestEnabled) await once("digest", lastOccurrence(now, s.timeZone, 1, 9), () => enqueue("send_digest", {}, { maxAttempts: 3 }));
  await once("reminders", lastDailyOccurrence(now, s.timeZone, 9), () => enqueue("send_reminders", {}, { maxAttempts: 3 }));
}

let started = false;

/** Long-running loop: N concurrent slots pulling from the Postgres queue. */
export function startWorker(concurrency = env().WORKER_CONCURRENCY) {
  if (started) return;
  started = true;
  console.log(`[worker] started with concurrency ${concurrency}`);
  let lastHousekeeping = 0;
  const slot = async () => {
    for (;;) {
      try {
        if (Date.now() - lastHousekeeping > 60_000) {
          lastHousekeeping = Date.now();
          await recoverStaleJobs();
          await schedulePolls();
          await scheduleNotifications();
        }
        const job = await claimJob();
        if (job) await handle(job);
        else await new Promise((r) => setTimeout(r, 1500));
      } catch (e) {
        console.error("[worker] loop error", e);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  };
  for (let i = 0; i < concurrency; i++) void slot();
}

/** Drains the queue once (tests, seed script). */
export async function drainQueue(max = 1000) {
  for (let i = 0; i < max; i++) {
    const job = await claimJob();
    if (!job) return i;
    await handle(job);
  }
  return max;
}
