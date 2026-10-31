import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { issueInvoice, sendInvoice, voidInvoice } from "@/invoices/invoices";

const Body = z.object({ action: z.enum(["issue", "send", "void"]), to: z.union([z.email(), z.literal("")]).optional() });

export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const { action, to } = Body.parse(await req.json());
  const actor = { type: "user" as const, id: user.id, ip: await clientIp() };
  try {
    if (action === "issue") await issueInvoice(id, actor);
    else if (action === "send") await sendInvoice(id, actor, to || undefined);
    else await voidInvoice(id, actor);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
