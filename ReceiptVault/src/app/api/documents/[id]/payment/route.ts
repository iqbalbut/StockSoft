import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { markPaid, markUnpaid, PaymentInput } from "@/pipeline/payables";

const Body = z.discriminatedUnion("action", [PaymentInput.extend({ action: z.literal("paid") }), z.object({ action: z.literal("unpaid") })]);

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const body = Body.parse(await req.json());
  const actor = { type: "user" as const, id: user.id, ip: await clientIp() };
  try {
    if (body.action === "paid") await markPaid(id, body, actor);
    else await markUnpaid(id, actor);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
