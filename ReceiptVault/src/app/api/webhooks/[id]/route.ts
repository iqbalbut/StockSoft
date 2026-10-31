import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit } from "@/lib/audit";
import { enqueue } from "@/pipeline/jobs";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handler(async (_req: Request, { params }: Ctx) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const db = await getDb();
  await db.update(schema.webhookEndpoints).set({ active: false }).where(eq(schema.webhookEndpoints.id, id));
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "webhook", id, "disabled");
  return NextResponse.json({ ok: true });
});

/** Sends a test event to this endpoint. */
export const POST = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser({ write: true });
  const { id } = await params;
  await enqueue("deliver_webhook", { endpointId: id, delivery: { id: crypto.randomUUID(), event: "test", createdAt: new Date().toISOString(), data: { hello: "from ReceiptVault" } } }, { maxAttempts: 1 });
  return NextResponse.json({ ok: true });
});
