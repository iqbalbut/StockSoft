import { sql, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";

export type JobType = "process_document" | "poll_gmail" | "poll_drive" | "deliver_webhook" | "send_digest" | "send_reminders" | "submit_ai_batch" | "poll_ai_batch";
export type Job = typeof schema.jobs.$inferSelect;

export async function enqueue(type: JobType, payload: Record<string, unknown>, opts: { runAt?: Date; maxAttempts?: number } = {}) {
  const db = await getDb();
  const [job] = await db
    .insert(schema.jobs)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 4 })
    .returning({ id: schema.jobs.id });
  return job.id;
}

/** Atomically claims the next due job (safe with many workers: FOR UPDATE SKIP LOCKED). */
export async function claimJob(): Promise<Job | null> {
  const db = await getDb();
  const res = await db.execute(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM jobs WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at, id FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id, type, payload, attempts, max_attempts`);
  const row = (res as unknown as { rows: Record<string, unknown>[] }).rows[0];
  if (!row) return null;
  return {
    id: Number(row.id),
    type: row.type as string,
    payload: row.payload,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
  } as Job;
}

export async function completeJob(id: number) {
  const db = await getDb();
  await db.update(schema.jobs).set({ status: "done", lockedAt: null }).where(eq(schema.jobs.id, id));
}

/** Exponential backoff: 30s, 2m, 8m, … until maxAttempts, then the job is parked as failed. */
export async function failJob(job: Job, error: string, permanent = false) {
  const db = await getDb();
  const dead = permanent || job.attempts >= job.maxAttempts;
  await db
    .update(schema.jobs)
    .set({
      status: dead ? "failed" : "pending",
      lockedAt: null,
      lastError: error.slice(0, 2000),
      runAt: new Date(Date.now() + 30_000 * 4 ** (job.attempts - 1)),
    })
    .where(eq(schema.jobs.id, job.id));
  return dead;
}

/** Jobs left "running" by a crashed worker go back to the queue. */
export async function recoverStaleJobs() {
  const db = await getDb();
  await db.execute(sql`UPDATE jobs SET status = 'pending', locked_at = NULL WHERE status = 'running' AND locked_at < now() - interval '15 minutes'`);
}
