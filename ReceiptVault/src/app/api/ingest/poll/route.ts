import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { enqueue } from "@/pipeline/jobs";
import { googleConfigured } from "@/ingest/google";
import { env } from "@/lib/env";

/** "Check Gmail / Drive now" button. */
export const POST = handler(async () => {
  await requireUser({ write: true });
  if (!googleConfigured()) return NextResponse.json({ error: "Google is not connected (see Settings)" }, { status: 400 });
  await enqueue("poll_gmail", {}, { maxAttempts: 1 });
  if (env().DRIVE_FOLDER_ID) await enqueue("poll_drive", {}, { maxAttempts: 1 });
  return NextResponse.json({ ok: true });
});
