import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * Next.js 16 "proxy" (formerly middleware). Lightweight gate for protected
 * routes: if there is no session cookie at all, redirect to /login immediately
 * (cheap, no DB access). The database session is then fully validated
 * server-side in the page via `auth()` — so a stale/forged cookie still gets
 * rejected there.
 */
export function proxy(req: NextRequest) {
  const hasSessionCookie = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/plans/:path*"],
};
