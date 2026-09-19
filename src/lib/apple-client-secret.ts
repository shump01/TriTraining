import { importPKCS8, SignJWT } from "jose";

/**
 * Sign in with Apple's "client secret" is not a secret string Apple hands
 * you: it is a JWT YOU mint, signed with the Sign in with Apple key (.p8)
 * from the developer portal, and Apple accepts it for at most six months.
 * Auth.js reads it from AUTH_APPLE_SECRET; scripts/apple-client-secret.mts
 * is the command that produces it, and this is the arithmetic it runs, kept
 * pure so the claims are unit-tested rather than discovered in production
 * when Apple answers invalid_client.
 */

/** Apple's ceiling is 15777000 seconds (~182.6 days); 180 keeps a margin. */
export const APPLE_SECRET_MAX_DAYS = 180;
export const APPLE_AUDIENCE = "https://appleid.apple.com";

export interface AppleClientSecretInput {
  /** The 10-character Team ID (Membership details). */
  teamId: string;
  /** The Key ID of the Sign in with Apple key. */
  keyId: string;
  /** The Services ID the website signs in as — the AUTH_APPLE_ID value. */
  clientId: string;
  /** The .p8 file's contents (PKCS#8 PEM). */
  privateKeyPem: string;
  /** Lifetime in days, capped at Apple's maximum. */
  days?: number;
  /** Issued-at, in seconds; defaults to now. Test seam. */
  nowSeconds?: number;
}

export async function makeAppleClientSecret(input: AppleClientSecretInput): Promise<string> {
  const days = Math.min(
    APPLE_SECRET_MAX_DAYS,
    Math.max(1, Math.floor(input.days ?? APPLE_SECRET_MAX_DAYS)),
  );
  const iat = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const key = await importPKCS8(input.privateKeyPem.trim(), "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: input.keyId })
    .setIssuer(input.teamId)
    .setIssuedAt(iat)
    .setExpirationTime(iat + days * 24 * 60 * 60)
    .setAudience(APPLE_AUDIENCE)
    .setSubject(input.clientId)
    .sign(key);
}
