import { NextResponse } from "next/server";
import { z } from "zod";
import { pendingMfaUser, issueSession, clientIp, rateLimit } from "@/lib/auth";
import { decryptString, verifyTotp } from "@/lib/crypto";
import { audit } from "@/lib/audit";
import { handler } from "@/lib/http";

export const POST = handler(async (req: Request) => {
  const { code } = z.object({ code: z.string() }).parse(await req.json());
  const user = await pendingMfaUser();
  if (!user || !user.totpSecretEnc) return NextResponse.json({ error: "Sign in again" }, { status: 401 });
  if (!rateLimit(`mfa:${user.id}`, 6)) return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  const ip = await clientIp();
  if (!verifyTotp(decryptString(user.totpSecretEnc), code)) {
    await audit({ type: "user", id: user.id, ip }, "auth", user.id, "mfa_failed");
    return NextResponse.json({ error: "Invalid code" }, { status: 401 });
  }
  await issueSession(user, "full");
  await audit({ type: "user", id: user.id, ip }, "auth", user.id, "login");
  return NextResponse.json({ ok: true });
});
