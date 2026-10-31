import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { buildDigest } from "@/pipeline/notifications";
import { enqueue } from "@/pipeline/jobs";

/** Preview this week's digest. */
export const GET = handler(async () => {
  await requireUser();
  const { headline, text, data } = await buildDigest();
  return NextResponse.json({ headline, text, data });
});

/** Send it now (email + digest.weekly webhook). */
export const POST = handler(async () => {
  await requireUser({ write: true });
  await enqueue("send_digest", {}, { maxAttempts: 1 });
  return NextResponse.json({ ok: true });
});
