import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { encryptString } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { EVENTS, validWebhookUrl } from "@/pipeline/events";

export const GET = handler(async () => {
  await requireUser({ write: true });
  const db = await getDb();
  const rows = await db.query.webhookEndpoints.findMany({ orderBy: desc(schema.webhookEndpoints.createdAt) });
  return NextResponse.json(rows.map(({ secret: _, ...r }) => r));
});

/** Creates an endpoint. The signing secret is returned once and stored encrypted. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser({ write: true });
  const body = z
    .object({ url: z.string().refine(validWebhookUrl, "Use an https:// URL"), events: z.array(z.enum([...EVENTS, "*"])).min(1) })
    .parse(await req.json());
  const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  const db = await getDb();
  const [row] = await db.insert(schema.webhookEndpoints).values({ url: body.url, events: body.events, secret: encryptString(secret) }).returning();
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "webhook", row.id, "created", { url: body.url, events: body.events });
  return NextResponse.json({ id: row.id, secret });
});
