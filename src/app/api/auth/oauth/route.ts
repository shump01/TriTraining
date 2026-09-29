import { NextResponse, type NextRequest } from "next/server";

import { handleApiError } from "@/lib/api";
import {
  MissingEmailError,
  signInWithProviderIdentity,
  UnverifiedEmailError,
} from "@/lib/oauth-account";
import {
  OAuthNotConfiguredError,
  OAuthTokenError,
  verifyProviderIdToken,
} from "@/lib/oauth-identity";
import { rateLimit } from "@/lib/rate-limit";
import { getClientIp, isCrossSiteRequest } from "@/lib/security";
import { createDatabaseSession } from "@/lib/session";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";
import { oauthSignInSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 10;
const WINDOW_MS = 60_000;

/**
 * POST /api/auth/oauth — the mobile app's Sign in with Apple / Google Sign-In.
 *
 * The app gets an ID token from the OS, we verify it against the provider's
 * keys, find-or-link-or-create the user, and mint the same database session
 * the password login does (token in the body for X-Client: mobile, cookie for
 * everyone). `created` tells the app whether this is a brand-new athlete.
 *
 * An identity we can't use — no email, an unverified email that is already an
 * account, an unverified email we won't make an account of — is a 409 with a
 * sentence the app shows as-is; the website refuses the same identities.
 */
export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const limit = rateLimit(`oauth:${getClientIp(req)}`, LIMIT, WINDOW_MS);
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
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const parsed = oauthSignInSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { provider, idToken, name } = parsed.data;

  try {
    const identity = await verifyProviderIdToken(provider, idToken);
    const result = await signInWithProviderIdentity(identity, { name });
    const { sessionToken, expires } = await createDatabaseSession(result.userId);

    const isMobileClient = req.headers.get("x-client") === "mobile";
    const res = NextResponse.json(
      isMobileClient
        ? { ok: true, sessionToken, expires: expires.toISOString(), created: result.created }
        : { ok: true, created: result.created },
      { status: 200 },
    );
    res.cookies.set(SESSION_COOKIE_NAME, sessionToken, { ...sessionCookieOptions, expires });
    return res;
  } catch (error) {
    if (error instanceof OAuthTokenError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof OAuthNotConfiguredError) {
      return NextResponse.json(
        { error: "This sign-in method isn't available yet." },
        { status: 503 },
      );
    }
    if (error instanceof MissingEmailError || error instanceof UnverifiedEmailError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return handleApiError(error, { route: "POST /api/auth/oauth", provider });
  }
}
