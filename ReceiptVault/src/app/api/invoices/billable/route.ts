import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { billableLines } from "@/invoices/invoices";

export const GET = handler(async (req: Request) => {
  await requireUser({ write: true });
  const url = new URL(req.url);
  const clientId = url.searchParams.get("clientId");
  if (!clientId) return NextResponse.json({ error: "clientId required" }, { status: 400 });
  return NextResponse.json(await billableLines(clientId, Number(url.searchParams.get("markup") ?? 0)));
});
