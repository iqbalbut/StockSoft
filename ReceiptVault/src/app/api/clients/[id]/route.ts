import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit, diff } from "@/lib/audit";
import { ClientInput } from "@/pipeline/clients";

export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const user = await requireUser({ write: true });
  const { id } = await params;
  const body = ClientInput.partial().parse(await req.json());
  const db = await getDb();
  const before = await db.query.clients.findFirst({ where: eq(schema.clients.id, id) });
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const patch = { ...body, code: body.code === undefined ? undefined : body.code || null, email: body.email === undefined ? undefined : body.email || null };
  await db.update(schema.clients).set(patch).where(eq(schema.clients.id, id));
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "client", id, "updated", diff(before, patch));
  return NextResponse.json({ ok: true });
});
