import { NextResponse } from "next/server";
import { z } from "zod";
import { count } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { hashPassword } from "@/lib/crypto";
import { issueSession, clientIp } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { handler } from "@/lib/http";

const Body = z.object({ email: z.email(), name: z.string().max(100).optional(), password: z.string().min(12, "Use at least 12 characters") });

/** First-run only: creates the owner account. Disabled once any user exists. */
export const POST = handler(async (req: Request) => {
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(schema.users);
  if (n > 0) return NextResponse.json({ error: "Setup already completed" }, { status: 403 });
  const body = Body.parse(await req.json());
  const [user] = await db
    .insert(schema.users)
    .values({ email: body.email.toLowerCase(), name: body.name, passwordHash: hashPassword(body.password), role: "owner" })
    .returning();
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "user", user.id, "created_owner");
  await issueSession(user, "full");
  return NextResponse.json({ ok: true });
});
