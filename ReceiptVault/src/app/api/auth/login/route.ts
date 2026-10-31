import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { verifyPassword } from "@/lib/crypto";
import { issueSession, clientIp, rateLimit } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { handler } from "@/lib/http";

const Body = z.object({ email: z.string(), password: z.string() });

export const POST = handler(async (req: Request) => {
  const { email, password } = Body.parse(await req.json());
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`) || !rateLimit(`login:${email.toLowerCase()}`)) {
    return NextResponse.json({ error: "Too many attempts. Try again in 15 minutes." }, { status: 429 });
  }
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.email, email.toLowerCase()) });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    await audit({ type: "system", ip }, "auth", email.toLowerCase(), "login_failed");
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  if (user.totpEnabled) {
    await issueSession(user, "mfa");
    return NextResponse.json({ mfa: true });
  }
  await issueSession(user, "full");
  await audit({ type: "user", id: user.id, ip }, "auth", user.id, "login");
  return NextResponse.json({ ok: true });
});
