import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { env, secret } from "./env";

const COOKIE = "rv_session";
const key = () => new TextEncoder().encode(secret("SESSION_SECRET"));

type Stage = "full" | "mfa";
type Claims = { uid: string; ver: number; stage: Stage };

export type SessionUser = typeof schema.users.$inferSelect;

export async function issueSession(user: SessionUser, stage: Stage) {
  const ttl = stage === "full" ? "14d" : "10m";
  const token = await new SignJWT({ uid: user.id, ver: user.sessionVersion, stage } satisfies Claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: env().APP_URL.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: stage === "full" ? 14 * 86400 : 600,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

async function readClaims(): Promise<Claims | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    return payload as unknown as Claims;
  } catch {
    return null;
  }
}

async function loadUser(stage: Stage): Promise<SessionUser | null> {
  const claims = await readClaims();
  if (!claims || claims.stage !== stage) return null;
  const db = await getDb();
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, claims.uid) });
  if (!user || user.sessionVersion !== claims.ver) return null;
  return user;
}

export const currentUser = () => loadUser("full");
export const pendingMfaUser = () => loadUser("mfa");

export class AuthError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

/** For route handlers / server actions. Accountants are read-only. */
export async function requireUser(opts: { write?: boolean } = {}) {
  const user = await currentUser();
  if (!user) throw new AuthError(401, "Not signed in");
  if (opts.write && user.role !== "owner") throw new AuthError(403, "Read-only role");
  return user;
}

export async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}

// Simple in-process brute-force limiter for login / 2FA (per key, 10 attempts / 15 min).
const attempts = new Map<string, { n: number; until: number }>();
export function rateLimit(k: string, max = 10, windowMs = 15 * 60_000): boolean {
  const now = Date.now();
  const cur = attempts.get(k);
  if (!cur || cur.until < now) {
    attempts.set(k, { n: 1, until: now + windowMs });
    return true;
  }
  cur.n++;
  return cur.n <= max;
}
