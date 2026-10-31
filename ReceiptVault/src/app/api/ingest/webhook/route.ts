import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { handler } from "@/lib/http";
import { ingest, type IncomingFile } from "@/pipeline/ingest";

export const maxDuration = 300;

const Json = z.object({
  source: z.enum(["webhook", "whatsapp", "gmail", "drive"]).default("webhook"),
  sourceRef: z.string().max(300).optional(),
  asPages: z.boolean().optional(),
  files: z.array(z.object({ filename: z.string().max(255), contentBase64: z.string() })).min(1).max(50),
});

function authorized(req: Request) {
  const key = env().INGEST_API_KEY;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!key || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

/**
 * Machine intake for n8n, Zapier, email-forwarding services (Postmark/Mailgun inbound) or a WhatsApp bot.
 * Auth: `Authorization: Bearer $INGEST_API_KEY`. Body: JSON (see schema above) or multipart `files[]`.
 */
export const POST = handler(async (req: Request) => {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actor = { type: "system" as const, id: "webhook" };
  if (req.headers.get("content-type")?.includes("multipart/form-data")) {
    const form = await req.formData();
    const files: IncomingFile[] = [];
    for (const v of form.getAll("files")) if (typeof v !== "string") files.push({ name: v.name, data: Buffer.from(await v.arrayBuffer()) });
    const src = form.get("source");
    const source = src === "whatsapp" ? "whatsapp" : "webhook";
    return NextResponse.json(await ingest({ files, source, sourceRef: (form.get("sourceRef") as string) || null, actor }));
  }
  const body = Json.parse(await req.json());
  const files = body.files.map((f) => ({ name: f.filename, data: Buffer.from(f.contentBase64, "base64") }));
  return NextResponse.json(await ingest({ files, source: body.source, sourceRef: body.sourceRef ?? null, asPages: body.asPages, actor }));
});
