import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";
import { enforceRateLimit } from "@/lib/security";
import { exchangeCodeForTokens } from "@/lib/strava/client";
import { upsertStravaConnection } from "@/lib/strava/connection";
import { STRAVA_STATE_COOKIE, verifyOAuthState } from "@/lib/strava/oauth-state";
import { UnauthorizedError, requireUserId } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function redirectTo(req: NextRequest, status: string) {
  const url = new URL("/dashboard", req.url);
  url.searchParams.set("strava", status);
  const res = NextResponse.redirect(url);
  // Clear the one-time state cookie on the way out.
  res.cookies.set(STRAVA_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

/** GET /api/strava/callback — Strava redirects here after the user approves. */
export async function GET(req: NextRequest) {
  const limited = enforceRateLimit(req, "strava:callback", 10, 60_000);
  if (limited) return limited;

  const params = req.nextUrl.searchParams;

  // User declined, or Strava returned an error.
  if (params.get("error")) {
    return redirectTo(req, "denied");
  }

  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.redirect(new URL("/login?callbackUrl=/dashboard", req.url));
    }
    logger.error("Strava callback auth check failed", {
      route: "GET /api/strava/callback",
      error,
    });
    return redirectTo(req, "error");
  }

  const code = params.get("code");
  const state = params.get("state");
  const scope = params.get("scope") ?? "";
  const cookieNonce = req.cookies.get(STRAVA_STATE_COOKIE)?.value;

  // CSRF: the signed state must verify AND be tied to this session + cookie.
  if (!code || !verifyOAuthState(state, cookieNonce, userId)) {
    return redirectTo(req, "error");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    await upsertStravaConnection(userId, tokens, scope);
  } catch (error) {
    logger.error("Strava callback token exchange failed", {
      route: "GET /api/strava/callback",
      error,
    });
    return redirectTo(req, "error");
  }

  return redirectTo(req, "connected");
}
