import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { audit } from "@/lib/audit";
import { ClientInput } from "@/pipeline/clients";


export const GET = handler(async () => {
  await requireUser();
  const db = await getDb();
  return NextResponse.json(await db.query.clients.findMany({ orderBy: asc(schema.clients.name) }));
});

export const POST = handler(async (req: Request) => {
  const user = await requireUser({ write: true });
  const body = ClientInput.parse(await req.json());
  const db = await getDb();
  const [c] = await db.insert(schema.clients).values({ name: body.name, code: body.code || null, email: body.email || null }).returning();
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "client", c.id, "created", body);
  return NextResponse.json(c);
});
