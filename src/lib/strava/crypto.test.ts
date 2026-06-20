import { describe, expect, it } from "vitest";

import { decryptSecret, encryptSecret } from "./crypto";

describe("strava token encryption (AES-256-GCM)", () => {
  it("round-trips a secret", () => {
    const secret = "strava-access-token-abc123";
    const encrypted = encryptSecret(secret);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("does not store the plaintext", () => {
    const secret = "super-secret-refresh-token";
    const encrypted = encryptSecret(secret);
    expect(encrypted).not.toContain(secret);
    // base64 ciphertext, clearly not the original.
    expect(encrypted).not.toBe(secret);
  });

  it("uses a random IV (same input → different ciphertext)", () => {
    const secret = "token";
    expect(encryptSecret(secret)).not.toBe(encryptSecret(secret));
  });

  it("rejects tampered ciphertext (GCM auth tag)", () => {
    const encrypted = encryptSecret("token");
    const bytes = Buffer.from(encrypted, "base64");
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0xff; // flip a ciphertext bit
    expect(() => decryptSecret(bytes.toString("base64"))).toThrow();
  });

  it("handles unicode and empty strings", () => {
    for (const s of ["", "héllo-🌍-tokén"]) {
      expect(decryptSecret(encryptSecret(s))).toBe(s);
    }
  });
});
