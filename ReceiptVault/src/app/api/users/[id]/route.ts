import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit } from "@/lib/audit";

/** Revokes access: the account can no longer sign in and existing sessions end. History is kept. */
export const DELETE = handler(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const owner = await requireUser({ write: true });
  const { id } = await params;
  if (id === owner.id) return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });
  const db = await getDb();
  await db
    .update(schema.users)
    .set({ passwordHash: "disabled", sessionVersion: sql`${schema.users.sessionVersion} + 1` })
    .where(eq(schema.users.id, id));
  await audit({ type: "user", id: owner.id, ip: await clientIp() }, "user", id, "access_revoked");
  return NextResponse.json({ ok: true });
});
