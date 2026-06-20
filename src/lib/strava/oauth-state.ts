import { createHmac, randomBytes, timingSafeEqual } from "crypto";

import { env } from "@/env";

/**
 * CSRF-resistant OAuth `state` for the Strava authorization flow.
 *
 * The state is `base64url(payload).base64url(hmac)` where payload is
 * `userId.nonce.issuedAt`, signed with HMAC-SHA256 keyed by AUTH_SECRET. The
 * nonce is also set as an httpOnly cookie; the callback verifies the signature,
 * that the embedded userId matches the current session, that the nonce matches
 * the cookie, and that it hasn't expired. An attacker can neither forge a valid
 * signature nor replay one without both the cookie and the matching session.
 */
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function sign(payload: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const STRAVA_STATE_COOKIE = "strava_oauth_state";

export function createOAuthState(userId: string): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = `${userId}.${nonce}.${Date.now()}`;
  const state = `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
  return { state, nonce };
}

export function verifyOAuthState(
  state: string | null | undefined,
  cookieNonce: string | null | undefined,
  sessionUserId: string,
): boolean {
  if (!state || !cookieNonce) return false;

  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return false;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf8");
  } catch {
    return false;
  }

  if (!safeEqual(signature, sign(payload))) return false;

  const [userId, nonce, issuedAtRaw] = payload.split(".");
  if (!userId || !nonce || !issuedAtRaw) return false;
  if (userId !== sessionUserId) return false; // tied to the current session
  if (!safeEqual(nonce, cookieNonce)) return false; // tied to the cookie

  const issuedAt = Number(issuedAtRaw);
  if (!Number.isFinite(issuedAt) || Date.now() - issuedAt > STATE_TTL_MS) return false;

  return true;
}
