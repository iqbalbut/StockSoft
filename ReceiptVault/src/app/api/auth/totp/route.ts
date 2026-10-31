import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { getDb, schema } from "@/db";
import { requireUser, clientIp, rateLimit } from "@/lib/auth";
import { newTotpSecret, totpUri, encryptString, decryptString, verifyTotp } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { handler } from "@/lib/http";

/** Starts 2FA enrolment: stores a new (not yet enabled) secret and returns its QR code. */
export const GET = handler(async () => {
  const user = await requireUser();
  if (user.totpEnabled) return NextResponse.json({ enabled: true });
  const secret = newTotpSecret();
  const db = await getDb();
  await db.update(schema.users).set({ totpSecretEnc: encryptString(secret) }).where(eq(schema.users.id, user.id));
  const uri = totpUri(secret, user.email);
  return NextResponse.json({ enabled: false, secret, qr: await QRCode.toDataURL(uri, { margin: 1, width: 240 }) });
});

/** Confirms enrolment (action=enable) or turns 2FA off (action=disable); both need a current code. */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const { code, action } = z.object({ code: z.string(), action: z.enum(["enable", "disable"]) }).parse(await req.json());
  if (!rateLimit(`totp:${user.id}`, 6)) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  if (!user.totpSecretEnc || !verifyTotp(decryptString(user.totpSecretEnc), code)) {
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }
  const db = await getDb();
  await db
    .update(schema.users)
    .set(
      action === "enable"
        ? { totpEnabled: true }
        : { totpEnabled: false, totpSecretEnc: null, sessionVersion: sql`${schema.users.sessionVersion} + 1` },
    )
    .where(eq(schema.users.id, user.id));
  await audit({ type: "user", id: user.id, ip: await clientIp() }, "user", user.id, action === "enable" ? "mfa_enabled" : "mfa_disabled");
  return NextResponse.json({ ok: true });
});
