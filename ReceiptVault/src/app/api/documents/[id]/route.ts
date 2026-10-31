import { NextResponse } from "next/server";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { getDocument } from "@/pipeline/queries";
import { updateDocument, DocumentPatch } from "@/pipeline/documents";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const doc = await getDocument((await params).id);
  return doc ? NextResponse.json(doc) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const PATCH = handler(async (req: Request, { params }: Ctx) => {
  const user = await requireUser({ write: true });
  const patch = DocumentPatch.parse(await req.json());
  const doc = await updateDocument((await params).id, patch, { type: "user", id: user.id, ip: await clientIp() });
  return NextResponse.json(doc);
});
