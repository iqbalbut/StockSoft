import { NextResponse } from "next/server";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { updateDraft, InvoiceInput, loadInvoice } from "@/invoices/invoices";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, { params }: Ctx) => {
  await requireUser();
  const r = await loadInvoice((await params).id);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "Not found" }, { status: 404 });
});

export const PUT = handler(async (req: Request, { params }: Ctx) => {
  const user = await requireUser({ write: true });
  try {
    await updateDraft((await params).id, InvoiceInput.parse(await req.json()), { type: "user", id: user.id, ip: await clientIp() });
  } catch (e) {
    if ((e as Error).name === "ZodError") throw e;
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});
