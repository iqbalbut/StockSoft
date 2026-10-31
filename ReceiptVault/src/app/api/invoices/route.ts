import { NextResponse } from "next/server";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { createDraft, InvoiceInput } from "@/invoices/invoices";

export const POST = handler(async (req: Request) => {
  const user = await requireUser({ write: true });
  const id = await createDraft(InvoiceInput.parse(await req.json()), { type: "user", id: user.id, ip: await clientIp() });
  return NextResponse.json({ id });
});
