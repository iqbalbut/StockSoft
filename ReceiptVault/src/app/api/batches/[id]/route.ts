import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { statusCounts } from "@/pipeline/queries";

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  await requireUser();
  return NextResponse.json({ counts: await statusCounts((await params).id) });
});
