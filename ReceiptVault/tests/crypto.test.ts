import "./setup-env";
import { describe, it, expect } from "vitest";
import { encrypt, decrypt, totpCode, verifyTotp, base32Encode, hashPassword, verifyPassword } from "@/lib/crypto";

describe("crypto", () => {
  it("round-trips AES-GCM and detects tampering", () => {
    const plain = Buffer.from("receipt bytes");
    const blob = encrypt(plain);
    expect(blob.includes(plain)).toBe(false);
    expect(decrypt(blob).equals(plain)).toBe(true);
    blob[blob.length - 1] ^= 1;
    expect(() => decrypt(blob)).toThrow();
  });

  it("matches the RFC 6238 TOTP test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1111111109_000)).toBe("081804");
    expect(verifyTotp(secret, "287082", 59_000 + 25_000)).toBe(true);
    expect(verifyTotp(secret, "000000", 59_000)).toBe(false);
  });

  it("hashes passwords with scrypt", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong", h)).toBe(false);
  });
});
