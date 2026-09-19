import { decodeProtectedHeader, exportPKCS8, generateKeyPair, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";

import {
  APPLE_AUDIENCE,
  APPLE_SECRET_MAX_DAYS,
  makeAppleClientSecret,
} from "./apple-client-secret";

const DAY = 24 * 60 * 60;

async function keyPair() {
  const pair = await generateKeyPair("ES256", { extractable: true });
  return { pem: await exportPKCS8(pair.privateKey), publicKey: pair.publicKey };
}

describe("makeAppleClientSecret", () => {
  it("mints the JWT Apple expects: ES256 with the key id, team as issuer, services id as subject", async () => {
    const { pem, publicKey } = await keyPair();
    const now = 1_800_000_000;
    const jwt = await makeAppleClientSecret({
      teamId: "VG8MTG2SWP",
      keyId: "ABC123DEFG",
      clientId: "uk.co.richysdev.tritrainer.web",
      privateKeyPem: pem,
      days: 30,
      nowSeconds: now,
    });

    expect(decodeProtectedHeader(jwt)).toEqual({ alg: "ES256", kid: "ABC123DEFG" });
    const { payload } = await jwtVerify(jwt, publicKey, {
      issuer: "VG8MTG2SWP",
      audience: APPLE_AUDIENCE,
      subject: "uk.co.richysdev.tritrainer.web",
      currentDate: new Date(now * 1000),
    });
    expect(payload.iat).toBe(now);
    expect(payload.exp).toBe(now + 30 * DAY);
  });

  it("never exceeds Apple's six-month ceiling, whatever is asked for", async () => {
    const { pem, publicKey } = await keyPair();
    const now = 1_800_000_000;
    const jwt = await makeAppleClientSecret({
      teamId: "T",
      keyId: "K",
      clientId: "C",
      privateKeyPem: pem,
      days: 400,
      nowSeconds: now,
    });
    const { payload } = await jwtVerify(jwt, publicKey, { currentDate: new Date(now * 1000) });
    expect(payload.exp).toBe(now + APPLE_SECRET_MAX_DAYS * DAY);
  });

  it("rejects a key that is not a PKCS#8 private key", async () => {
    await expect(
      makeAppleClientSecret({ teamId: "T", keyId: "K", clientId: "C", privateKeyPem: "not a key" }),
    ).rejects.toThrow();
  });
});
