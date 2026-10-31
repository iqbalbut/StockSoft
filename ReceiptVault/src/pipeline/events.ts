import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { decryptString } from "@/lib/crypto";
import { env } from "@/lib/env";
import { enqueue } from "./jobs";

export const EVENTS = [
  "document.processed",
  "document.approved",
  "document.needs_review",
  "bill.due_soon",
  "bill.paid",
  "invoice.paid",
  "digest.weekly",
] as const;
export type EventName = (typeof EVENTS)[number];

/** Queues a signed delivery to every active endpoint subscribed to the event ("*" = all). */
export async function emit(event: EventName, data: Record<string, unknown>) {
  const db = await getDb();
  const endpoints = await db.query.webhookEndpoints.findMany({ where: eq(schema.webhookEndpoints.active, true) });
  for (const ep of endpoints) {
    if (!ep.events.includes(event) && !ep.events.includes("*")) continue;
    await enqueue("deliver_webhook", { endpointId: ep.id, delivery: { id: crypto.randomUUID(), event, createdAt: new Date().toISOString(), data } }, { maxAttempts: 6 });
  }
}

/** `X-ReceiptVault-Signature: sha256=<hex HMAC of "<timestamp>.<body>">` (verify in n8n with a Crypto node). */
export function sign(secret: string, timestamp: string, body: string) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function validWebhookUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (env().NODE_ENV !== "production" || ["localhost", "127.0.0.1"].includes(u.hostname));
  } catch {
    return false;
  }
}

export async function deliverWebhook(payload: { endpointId: string; delivery: Record<string, unknown> }, fetcher: typeof fetch = fetch) {
  const db = await getDb();
  const ep = await db.query.webhookEndpoints.findFirst({ where: eq(schema.webhookEndpoints.id, payload.endpointId) });
  if (!ep || !ep.active) return;
  const body = JSON.stringify(payload.delivery);
  const ts = String(Math.floor(Date.now() / 1000));
  let status: string;
  try {
    const res = await fetcher(ep.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "ReceiptVault-Webhooks/1",
        "x-receiptvault-event": String(payload.delivery.event),
        "x-receiptvault-delivery": String(payload.delivery.id),
        "x-receiptvault-timestamp": ts,
        "x-receiptvault-signature": sign(decryptString(ep.secret), ts, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    status = `${res.status} at ${new Date().toISOString()}`;
    await db.update(schema.webhookEndpoints).set({ lastStatus: status }).where(eq(schema.webhookEndpoints.id, ep.id));
    if (!res.ok) throw new Error(`Webhook ${ep.url} answered ${res.status}`);
  } catch (e) {
    status = `error: ${(e as Error).message}`.slice(0, 200);
    await db.update(schema.webhookEndpoints).set({ lastStatus: status }).where(eq(schema.webhookEndpoints.id, ep.id));
    throw e; // retried with backoff by the job queue
  }
}
