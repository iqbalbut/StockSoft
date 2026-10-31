import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { confirmMatch, setTxnStatus } from "@/bank/match";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), documentId: z.uuid() }),
  z.object({ action: z.literal("unmatch") }),
  z.object({ action: z.literal("ignore") }),
]);

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const body = Body.parse(await req.json());
  const actor = { type: "user" as const, id: user.id, ip: await clientIp() };
  try {
    if (body.action === "confirm") await confirmMatch(id, body.documentId, actor);
    else await setTxnStatus(id, body.action === "ignore" ? "ignored" : "unmatched", actor);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
