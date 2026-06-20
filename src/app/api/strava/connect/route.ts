import { NextResponse, type NextRequest } from "next/server";

import { buildAuthorizeUrl } from "@/lib/strava/client";
import { STRAVA_STATE_COOKIE, createOAuthState } from "@/lib/strava/oauth-state";
import { UnauthorizedError, requireUserId } from "@/lib/training-plan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/strava/connect — start the Strava OAuth flow. Issues a signed,
 * session-bound state, stashes its nonce in an httpOnly cookie, and redirects
 * the browser to Strava's authorize screen.
 */
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.redirect(new URL("/login?callbackUrl=/dashboard", req.url));
    }
    throw error;
  }

  const { state, nonce } = createOAuthState(userId);
  const res = NextResponse.redirect(buildAuthorizeUrl(state));
  res.cookies.set(STRAVA_STATE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes
  });
  return res;
}
