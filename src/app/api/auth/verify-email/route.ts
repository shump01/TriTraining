import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import { rateLimit, refundRateLimit } from "@/lib/rate-limit";
import { getClientIp, isCrossSiteRequest } from "@/lib/security";
import { createDatabaseSession } from "@/lib/session";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";
import { confirmSignup } from "@/lib/signup-verification";
import { verifyEmailSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Failed confirmations per IP. Successes never spend it (see below).
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 15 * 60_000;

const INVALID_LINK =
  "This link has already been used or has expired. If you already confirmed, just sign in — otherwise sign up again for a fresh link.";
// Also the answer when the attempt this person made has been displaced (only
// the newest few per address are kept), so it must offer the way out.
const WRONG_PASSWORD =
  "That doesn't match the password you chose when you signed up. Check it and try again — or sign up again for a fresh link.";

/**
 * POST /api/auth/verify-email { token, password } — finish a sign-up.
 *
 * POST only: the page at /verify-email/[token] renders a form and a GET never
 * consumes anything, because mail scanners and link previews fetch every URL
 * in an email.
 *
 * On success the athlete is signed straight in. That is safe only because the
 * confirmer had to supply the password chosen at sign-up — clicking someone
 * else's link proves the inbox, not the password, and can't create an account
 * (src/lib/signup-verification.ts explains why that distinction is the whole
 * point).
 *
 * Only FAILURES count, as the cron route does for bad bearers: a good token
 * is 256 bits and cannot be guessed, so a successful confirm has nothing to
 * rate-limit — while counting it would let one busy shared IP (or every
 * visitor, if TRUSTED_PROXY_COUNT is unset and the whole site shares a bucket)
 * lock real people out of finishing their sign-up.
 *
 * But the unit is RESERVED before any work and refunded on success, not
 * spent after a failure. Each attempt can cost up to one argon2 verification
 * per live sign-up attempt, and "spend on failure" only counts a failure once
 * it has finished — so a burst of concurrent requests would all pass the
 * check first and buy that work hundreds of times over. Reserving is
 * synchronous, so no more than the limit can ever be in flight per IP.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = verifyEmailSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    );
  }

  // Reserve before the argon2 work (see above); refunded below on success.
  const failureKey = `auth:verify-fail:${getClientIp(req)}`;
  const slot = rateLimit(failureKey, FAILURE_LIMIT, FAILURE_WINDOW_MS);
  if (!slot.ok) return tooMany(slot.retryAfterSeconds);

  try {
    const result = await confirmSignup(parsed.data.token, parsed.data.password);

    if (result.status === "invalid_token" || result.status === "wrong_password") {
      // The reserved unit stays spent: this is the failure it was for.
      return result.status === "invalid_token"
        ? NextResponse.json({ error: INVALID_LINK, code: "INVALID_LINK" }, { status: 400 })
        : NextResponse.json({ error: WRONG_PASSWORD, code: "WRONG_PASSWORD" }, { status: 400 });
    }

    // A real outcome, not a failed guess — give the unit back.
    refundRateLimit(failureKey);

    if (result.status === "already_registered") {
      // Only the inbox's owner holds this link, so telling them their address
      // already has an account reveals nothing they couldn't find out anyway.
      return NextResponse.json(
        {
          ok: true,
          status: "already_registered",
          message: "This email address already has an account — sign in to continue.",
        },
        { status: 200 },
      );
    }

    const { sessionToken, expires } = await createDatabaseSession(result.userId);
    // Same shape as login: cookie for the web; the token in the body for the
    // mobile client, which can't read an httpOnly cookie.
    const isMobileClient = req.headers.get("x-client") === "mobile";
    const res = NextResponse.json(
      isMobileClient
        ? { ok: true, status: "created", sessionToken, expires: expires.toISOString() }
        : { ok: true, status: "created" },
      { status: 200 },
    );
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, { ...sessionCookieOptions, expires });
    return res;
  } catch (error) {
    return handleApiError(error, { route: "POST /api/auth/verify-email" });
  }
}

function tooMany(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many attempts. Please try again later." },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
  );
}
