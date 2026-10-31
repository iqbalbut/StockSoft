import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { approveDocument, rejectDocument, reprocessDocument } from "@/pipeline/documents";

const Body = z.object({ action: z.enum(["approve", "reject", "reprocess"]), reason: z.string().max(500).optional() });

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const { action, reason } = Body.parse(await req.json());
  const actor = { type: "user" as const, id: user.id, ip: await clientIp() };
  try {
    if (action === "approve") await approveDocument(id, actor);
    else if (action === "reject") await rejectDocument(id, actor, reason);
    else await reprocessDocument(id, actor);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
