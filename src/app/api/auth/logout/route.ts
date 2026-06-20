import { NextResponse, type NextRequest } from "next/server";

import { isCrossSiteRequest } from "@/lib/security";
import { destroyDatabaseSession } from "@/lib/session";
import { SESSION_COOKIE_NAME, sessionCookieOptions } from "@/lib/session-cookie";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    await destroyDatabaseSession(token);
  }

  const res = NextResponse.json({ ok: true }, { status: 200 });
  // Clear the cookie.
  res.cookies.set(SESSION_COOKIE_NAME, "", {
    ...sessionCookieOptions,
    expires: new Date(0),
    maxAge: 0,
  });
  return res;
}
