import { NextResponse } from "next/server";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireUser, clientIp } from "@/lib/auth";
import { handler } from "@/lib/http";
import { hashPassword } from "@/lib/crypto";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  await requireUser({ write: true });
  const db = await getDb();
  const users = await db.query.users.findMany({ orderBy: asc(schema.users.createdAt) });
  return NextResponse.json(users.map((u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, totpEnabled: u.totpEnabled, disabled: u.passwordHash === "disabled" })));
});

/** Owner adds an accountant (read-only + exports). They should turn on 2FA at first sign-in. */
export const POST = handler(async (req: Request) => {
  const owner = await requireUser({ write: true });
  const body = z.object({ email: z.email(), name: z.string().max(100).optional(), password: z.string().min(12, "Use at least 12 characters") }).parse(await req.json());
  const db = await getDb();
  if (await db.query.users.findFirst({ where: eq(schema.users.email, body.email.toLowerCase()) })) {
    return NextResponse.json({ error: "That email already has an account" }, { status: 400 });
  }
  const [u] = await db.insert(schema.users).values({ email: body.email.toLowerCase(), name: body.name, passwordHash: hashPassword(body.password), role: "accountant" }).returning();
  await audit({ type: "user", id: owner.id, ip: await clientIp() }, "user", u.id, "accountant_added", { email: u.email });
  return NextResponse.json({ id: u.id });
});
