import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit } from "@/lib/audit";

/** Marks billable expenses as re-invoiced to the client (Phase 3 will create the invoice itself). */
export const POST = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const { documentIds, undo } = z.object({ documentIds: z.array(z.uuid()).min(1).max(500), undo: z.boolean().optional() }).parse(await req.json());
  const db = await getDb();
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db
    .update(schema.documents)
    .set({ rebilledAt: undo ? null : today, updatedAt: new Date() })
    .where(and(inArray(schema.documents.id, documentIds), eq(schema.documents.clientId, id), eq(schema.documents.isBillable, true), undo ? undefined : isNull(schema.documents.rebilledAt)))
    .returning({ id: schema.documents.id });
  for (const r of rows) await audit({ type: "user", id: user.id, ip: await clientIp() }, "document", r.id, undo ? "rebill_undone" : "rebilled", { clientId: id });
  return NextResponse.json({ updated: rows.length });
});
