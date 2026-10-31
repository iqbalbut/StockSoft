import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { runMatching } from "@/bank/match";

/** Re-run matching (e.g. after new receipts arrived). */
export const POST = handler(async () => {
  await requireUser({ write: true });
  return NextResponse.json(await runMatching());
});
