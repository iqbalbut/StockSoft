import crypto from "node:crypto";
import { secret } from "./env";

const MAGIC = Buffer.from("RV1"); // versioned envelope: RV1 | iv(12) | tag(16) | ciphertext

function key(): Buffer {
  const k = Buffer.from(secret("ENCRYPTION_KEY"), "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  return k;
}

/** AES-256-GCM. Applied to every stored file regardless of the storage provider's own encryption. */
export function encrypt(plain: Buffer): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer): Buffer {
  if (!blob.subarray(0, 3).equals(MAGIC)) throw new Error("Unknown encryption envelope");
  const iv = blob.subarray(3, 15);
  const tag = blob.subarray(15, 31);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(31)), decipher.final()]);
}

export const encryptString = (s: string) => encrypt(Buffer.from(s, "utf8")).toString("base64");
export const decryptString = (s: string) => decrypt(Buffer.from(s, "base64")).toString("utf8");

export const sha256 = (buf: Buffer) => crypto.createHash("sha256").update(buf).digest("hex");

// ---- Passwords (scrypt, no native deps) ----
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// ---- TOTP (RFC 6238, SHA-1, 30s, 6 digits — compatible with Google Authenticator / 1Password) ----
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx < 0) throw new Error("Invalid base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totpCode(secretB32: string, time = Date.now(), step = 30): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(counter).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Accepts the current code and one step either side for clock drift. */
export function verifyTotp(secretB32: string, code: string, time = Date.now()): boolean {
  const c = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  return [-1, 0, 1].some((w) =>
    crypto.timingSafeEqual(Buffer.from(totpCode(secretB32, time + w * 30_000)), Buffer.from(c)),
  );
}

export const totpUri = (secretB32: string, account: string, issuer = "AiNetworks ReceiptVault") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
