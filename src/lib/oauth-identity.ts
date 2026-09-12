import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Verifies the ID token a native sign-in hands the mobile app — Sign in with
 * Apple's `identityToken`, Google Sign-In's `idToken` — and reduces it to the
 * identity we act on. Signature is checked against the provider's published
 * JWKS (fetched and cached by jose), issuer and audience against ours. The
 * website's own OAuth flows go through Auth.js and never touch this module;
 * it exists because the app can't use browser cookies and gets the token
 * straight from the OS instead.
 */

export type OAuthProvider = "apple" | "google";

export interface ProviderIdentity {
  provider: OAuthProvider;
  /** The provider's stable subject for this person — Account.providerAccountId. */
  subject: string;
  email: string | null;
  /** Only a verified email may link to an existing account (see oauth-account.ts). */
  emailVerified: boolean;
  /** Google puts a display name in the token; Apple never does (the app sends it once). */
  name: string | null;
}

/** The token could not be verified — wrong signature, issuer, audience, or expired. */
export class OAuthTokenError extends Error {
  constructor(message = "Sign-in could not be verified.") {
    super(message);
    this.name = "OAuthTokenError";
  }
}

/** No audience is configured for the provider — a deployment gap, not a bad token. */
export class OAuthNotConfiguredError extends Error {
  constructor(provider: OAuthProvider) {
    super(`${provider} sign-in is not configured on this server.`);
    this.name = "OAuthNotConfiguredError";
  }
}

const ISSUERS: Record<OAuthProvider, string | string[]> = {
  apple: "https://appleid.apple.com",
  // Google has issued both forms over the years; accept either.
  google: ["https://accounts.google.com", "accounts.google.com"],
};

const JWKS_URLS: Record<OAuthProvider, string> = {
  apple: "https://appleid.apple.com/auth/keys",
  google: "https://www.googleapis.com/oauth2/v3/certs",
};

/**
 * Audiences we accept per provider. A provider mints a token FOR a client,
 * and we have more than one:
 * - Apple: the iOS app (bundle id) and the website's Services ID.
 * - Google: the web client (Android tokens are issued for it) and the iOS client.
 */
export function providerAudiences(provider: OAuthProvider): string[] {
  const env = process.env;
  const raw =
    provider === "apple"
      ? [env.APPLE_BUNDLE_ID, env.AUTH_APPLE_ID]
      : [env.AUTH_GOOGLE_ID, env.GOOGLE_IOS_CLIENT_ID];
  return raw.map((v) => v?.trim() ?? "").filter((v) => v.length > 0);
}

const remoteKeySets = new Map<OAuthProvider, JWTVerifyGetKey>();

function remoteKeys(provider: OAuthProvider): JWTVerifyGetKey {
  let keys = remoteKeySets.get(provider);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(JWKS_URLS[provider]));
    remoteKeySets.set(provider, keys);
  }
  return keys;
}

export interface VerifyOptions {
  /** Test seam: a local key set instead of the provider's JWKS. */
  getKey?: JWTVerifyGetKey;
  /** Test seam: audiences instead of the environment's. */
  audiences?: string[];
}

export async function verifyProviderIdToken(
  provider: OAuthProvider,
  idToken: string,
  options: VerifyOptions = {},
): Promise<ProviderIdentity> {
  const audiences = options.audiences ?? providerAudiences(provider);
  if (audiences.length === 0) throw new OAuthNotConfiguredError(provider);

  let payload;
  try {
    ({ payload } = await jwtVerify(idToken, options.getKey ?? remoteKeys(provider), {
      issuer: ISSUERS[provider],
      audience: audiences,
      // Both providers sign with RS256; pinning it rejects "alg: none" style tokens.
      algorithms: ["RS256"],
    }));
  } catch (error) {
    if (error instanceof joseErrors.JOSEError) throw new OAuthTokenError();
    throw error;
  }

  if (typeof payload.sub !== "string" || payload.sub.length === 0) throw new OAuthTokenError();

  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : null;
  // Apple sends email_verified as the STRING "true" on some tokens and a
  // boolean on others; Google sends a boolean.
  const verifiedClaim = payload.email_verified;
  const emailVerified = email !== null && (verifiedClaim === true || verifiedClaim === "true");
  const name =
    provider === "google" && typeof payload.name === "string" && payload.name.trim()
      ? payload.name.trim()
      : null;

  return { provider, subject: payload.sub, email, emailVerified, name };
}
