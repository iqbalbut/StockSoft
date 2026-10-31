import { and, eq, inArray } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { getDb, schema } from "@/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { buildUserContent, extractionMode, getClient, parseReply, requestParams, PermanentExtractionError } from "@/extraction/extract";
import { enqueue } from "./jobs";
import { applyExtraction, loadPages, markFailed } from "./process";

/**
 * Economy mode: backlog documents go through the Message Batches API at half the price. Results usually
 * arrive within an hour (24 h at most). Anything a batch can't finish cleanly (validation retry needed,
 * errored, expired) falls back to the normal real-time path, so nothing is dropped.
 */
type BatchClient = Pick<Anthropic["messages"]["batches"], "create" | "retrieve" | "results">;
const batches = (): BatchClient => getClient().messages.batches;

const MAX_PER_BATCH = 100;

export async function submitAiBatch(batchId: string | null, client: BatchClient = batches()) {
  const db = await getDb();
  const docs = await db.query.documents.findMany({
    columns: { id: true },
    where: and(
      eq(schema.documents.economy, true),
      eq(schema.documents.status, "queued"),
      batchId ? eq(schema.documents.batchId, batchId) : undefined,
    ),
    limit: 1000,
  });
  const pending = docs.map((d) => d.id);
  if (!pending.length) return 0;

  // Demo mode has no API to batch against: process normally.
  if (extractionMode() !== "claude") {
    for (const id of pending) await enqueue("process_document", { documentId: id });
    return 0;
  }

  let submitted = 0;
  for (let i = 0; i < pending.length; i += MAX_PER_BATCH) {
    const ids = pending.slice(i, i + MAX_PER_BATCH);
    const requests = [];
    for (const id of ids) {
      const content = await buildUserContent(await loadPages(id));
      const { model, max_tokens, thinking, output_config, system, messages } = requestParams([{ role: "user", content }]);
      requests.push({ custom_id: id, params: { model, max_tokens, thinking, output_config, system, messages } });
    }
    const [row] = await db.insert(schema.aiBatches).values({ documentIds: ids }).returning();
    const created = await client.create({ requests: requests as unknown as Parameters<BatchClient["create"]>[0]["requests"] });
    await db.update(schema.aiBatches).set({ anthropicId: created.id }).where(eq(schema.aiBatches.id, row.id));
    await db.update(schema.documents).set({ status: "processing", aiBatchId: row.id, updatedAt: new Date() }).where(inArray(schema.documents.id, ids));
    await audit({ type: "system" }, "ai_batch", row.id, "submitted", { anthropicId: created.id, documents: ids.length });
    await enqueue("poll_ai_batch", { aiBatchId: row.id }, { runAt: new Date(Date.now() + env().BATCH_POLL_SECONDS * 1000), maxAttempts: 10 });
    submitted += ids.length;
  }
  return submitted;
}

/** Returns true when finished; otherwise the caller re-queues the poll. */
export async function pollAiBatch(aiBatchId: string, client: BatchClient = batches(), deps: Parameters<typeof applyExtraction>[2] = {}) {
  const db = await getDb();
  const row = await db.query.aiBatches.findFirst({ where: eq(schema.aiBatches.id, aiBatchId) });
  if (!row?.anthropicId || row.status !== "submitted") return true;
  const batch = await client.retrieve(row.anthropicId);
  if (batch.processing_status !== "ended") {
    await enqueue("poll_ai_batch", { aiBatchId }, { runAt: new Date(Date.now() + env().BATCH_POLL_SECONDS * 1000), maxAttempts: 10 });
    return false;
  }

  const seen = new Set<string>();
  let applied = 0, fallback = 0;
  for await (const item of await client.results(row.anthropicId)) {
    const id = item.custom_id;
    seen.add(id);
    try {
      if (item.result.type !== "succeeded") throw new Error(`batch result ${item.result.type}`);
      const msg = item.result.message;
      const r = parseReply(msg);
      if (!("extraction" in r)) throw new Error(r.problem);
      await applyExtraction(id, {
        extraction: r.extraction,
        model: msg.model,
        attempts: 1,
        viaBatch: true,
        usage: { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cacheRead: msg.usage.cache_read_input_tokens ?? 0 },
      }, deps);
      applied++;
    } catch (e) {
      if (e instanceof PermanentExtractionError) {
        await markFailed(id, e.message);
        continue;
      }
      // Needs a validation retry or the request failed: hand it to the real-time path.
      await db.update(schema.documents).set({ status: "queued", economy: false }).where(eq(schema.documents.id, id));
      await enqueue("process_document", { documentId: id });
      fallback++;
    }
  }
  for (const id of row.documentIds.filter((x) => !seen.has(x))) {
    await db.update(schema.documents).set({ status: "queued", economy: false }).where(eq(schema.documents.id, id));
    await enqueue("process_document", { documentId: id });
    fallback++;
  }
  await db.update(schema.aiBatches).set({ status: "ended", endedAt: new Date() }).where(eq(schema.aiBatches.id, aiBatchId));
  await audit({ type: "system" }, "ai_batch", aiBatchId, "ended", { applied, fallback });
  return true;
}
