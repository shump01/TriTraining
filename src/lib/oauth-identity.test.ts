import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { OAuthNotConfiguredError, OAuthTokenError, verifyProviderIdToken } from "./oauth-identity";

// The provider's signing key, stood in for by a local pair: tokens are minted
// with the private half and verified through a local JWKS of the public half,
// exactly as the real JWKS URL would serve it.
const APPLE_APP = "uk.co.richysdev.tritrainer";
const APPLE_WEB = "uk.co.richysdev.tritrainer.web";
const APPLE_AUD = [APPLE_APP, APPLE_WEB];
const GOOGLE_WEB = "web-client.apps.googleusercontent.com";
const GOOGLE_IOS = "ios-client.apps.googleusercontent.com";
const GOOGLE_AUD = [GOOGLE_WEB, GOOGLE_IOS];

let signingKey: CryptoKey;
let strangerKey: CryptoKey;
let getKey: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  signingKey = pair.privateKey;
  const jwk = await exportJWK(pair.publicKey);
  getKey = createLocalJWKSet({ keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-key" }] });
  strangerKey = (await generateKeyPair("RS256")).privateKey;
});

async function mint(
  claims: Record<string, unknown>,
  opts: {
    issuer?: string;
    audience?: string;
    subject?: string | null;
    key?: CryptoKey;
    expiresAt?: number;
  } = {},
): Promise<string> {
  const jwt = new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(opts.issuer ?? "https://appleid.apple.com")
    .setAudience(opts.audience ?? APPLE_APP)
    .setIssuedAt()
    .setExpirationTime(opts.expiresAt ?? Math.floor(Date.now() / 1000) + 300);
  if (opts.subject !== null) jwt.setSubject(opts.subject ?? "provider-sub-1");
  return jwt.sign(opts.key ?? signingKey);
}

describe("verifyProviderIdToken", () => {
  it("reduces an Apple token to its identity (email_verified as the string 'true')", async () => {
    const token = await mint({ email: "Athlete@Example.com", email_verified: "true" });
    const identity = await verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD });
    expect(identity).toEqual({
      provider: "apple",
      subject: "provider-sub-1",
      email: "athlete@example.com",
      emailVerified: true,
      name: null,
    });
  });

  it("accepts the website's Services ID as an Apple audience too", async () => {
    const token = await mint(
      { email: "a@example.com", email_verified: true },
      { audience: APPLE_WEB },
    );
    const identity = await verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD });
    expect(identity.subject).toBe("provider-sub-1");
  });

  it("reads Google's name claim and either issuer form", async () => {
    const token = await mint(
      { email: "g@example.com", email_verified: true, name: "  Sam Rider " },
      { issuer: "accounts.google.com", audience: GOOGLE_IOS, subject: "google-sub" },
    );
    const identity = await verifyProviderIdToken("google", token, {
      getKey,
      audiences: GOOGLE_AUD,
    });
    expect(identity).toEqual({
      provider: "google",
      subject: "google-sub",
      email: "g@example.com",
      emailVerified: true,
      name: "Sam Rider",
    });
  });

  it("reports an unverified email as unverified, and a missing one as null", async () => {
    const unverified = await mint({ email: "u@example.com", email_verified: false });
    expect(
      (await verifyProviderIdToken("apple", unverified, { getKey, audiences: APPLE_AUD }))
        .emailVerified,
    ).toBe(false);
    const none = await mint({});
    const identity = await verifyProviderIdToken("apple", none, { getKey, audiences: APPLE_AUD });
    expect(identity.email).toBeNull();
    expect(identity.emailVerified).toBe(false);
  });

  it("rejects a token minted for someone else's app", async () => {
    const token = await mint({ email: "a@example.com" }, { audience: "com.other.app" });
    await expect(
      verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD }),
    ).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("rejects the wrong issuer for the provider", async () => {
    const token = await mint({}, { issuer: "https://accounts.google.com" });
    await expect(
      verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD }),
    ).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("rejects an expired token", async () => {
    const token = await mint({}, { expiresAt: Math.floor(Date.now() / 1000) - 60 });
    await expect(
      verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD }),
    ).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("rejects a token signed by a key the provider never published", async () => {
    const token = await mint({}, { key: strangerKey });
    await expect(
      verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD }),
    ).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("rejects a token without a subject", async () => {
    const token = await mint({}, { subject: null });
    await expect(
      verifyProviderIdToken("apple", token, { getKey, audiences: APPLE_AUD }),
    ).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("rejects garbage without touching the network", async () => {
    await expect(
      verifyProviderIdToken("google", "not-a-jwt", { getKey, audiences: GOOGLE_AUD }),
    ).rejects.toBeInstanceOf(OAuthTokenError);
  });

  it("refuses to verify when no audience is configured for the provider", async () => {
    const token = await mint({});
    await expect(
      verifyProviderIdToken("apple", token, { getKey, audiences: [] }),
    ).rejects.toBeInstanceOf(OAuthNotConfiguredError);
  });
});
