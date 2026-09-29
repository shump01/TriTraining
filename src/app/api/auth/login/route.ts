import { NextResponse, type NextRequest } from "next/server";

import { verifyPassword } from "@/lib/password";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, isCrossSiteRequest } from "@/lib/security";
import { createDatabaseSession } from "@/lib/session";
import { newestPendingSignupHash } from "@/lib/signup-verification";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGIN_LIMIT = 5;
const WINDOW_MS = 60_000;

// Single generic message for every failure path — no user enumeration.
const INVALID_CREDENTIALS = "Invalid email or password.";

// Right email AND right password, but the sign-up was never confirmed. Worded
// as a next step, not an error: the App Store build that predates email
// verification signs in straight after signing up, lands here, and shows this
// text verbatim in its error slot — so it must read as "almost there".
const EMAIL_UNVERIFIED =
  "Almost there — confirm your email address first. We sent you a link (check your spam folder too).";

export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Rate limit failed + successful attempts alike to throttle brute force.
  const limit = rateLimit(`login:${getClientIp(req)}`, LOGIN_LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const email = parsed.data.email.toLowerCase();
  // Both lookups on EVERY request, in parallel: skipping the pending lookup
  // whenever the user exists would add a query to exactly the no-account path.
  const [user, pendingHash] = await Promise.all([
    prisma.user.findUnique({ where: { email } }),
    newestPendingSignupHash(email),
  ]);

  // Exactly one argon2 verification on every path — against the account's
  // hash, else the newest unconfirmed sign-up's, else the dummy (verifyPassword
  // with no hash) — so timing can't tell the three apart.
  if (!user && pendingHash) {
    const matchesPending = await verifyPassword(pendingHash, parsed.data.password);
    // A 403 only for the person who knows the password they signed up with;
    // anyone else sees the same generic 401 as a nonexistent account.
    if (matchesPending) {
      return NextResponse.json(
        { error: EMAIL_UNVERIFIED, code: "EMAIL_UNVERIFIED" },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  // verifyPassword performs a dummy hash when the user/hash is absent, so the
  // "no such user" and "wrong password" paths are indistinguishable by timing.
  const valid = await verifyPassword(user?.passwordHash, parsed.data.password);
  if (!user || !valid) {
    return NextResponse.json({ error: INVALID_CREDENTIALS }, { status: 401 });
  }

  const { sessionToken, expires } = await createDatabaseSession(user.id);

  // The mobile app (X-Client: mobile) stores the session token itself and sends
  // it back as a Bearer header — it can't use the httpOnly cookie. Web callers
  // keep the cookie-only response.
  const isMobileClient = req.headers.get("x-client") === "mobile";
  const res = NextResponse.json(
    isMobileClient ? { ok: true, sessionToken, expires: expires.toISOString() } : { ok: true },
    { status: 200 },
  );
  res.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
    ...sessionCookieOptions,
    expires,
  });
  return res;
}
