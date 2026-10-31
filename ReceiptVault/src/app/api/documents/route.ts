import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { handler } from "@/lib/http";
import { listDocuments, statusCounts } from "@/pipeline/queries";

export const GET = handler(async (req: Request) => {
  await requireUser();
  const url = new URL(req.url);
  const statuses = url.searchParams.get("status")?.split(",").filter(Boolean);
  const items = await listDocuments({
    statuses,
    q: url.searchParams.get("q") ?? undefined,
    limit: Number(url.searchParams.get("limit") ?? 50),
    offset: Number(url.searchParams.get("offset") ?? 0),
    order: url.searchParams.get("order") === "oldest" ? "oldest" : "newest",
  });
  return NextResponse.json({ items, counts: await statusCounts() });
});
