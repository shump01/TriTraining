import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/session-cookie";

/**
 * Next.js 16 "proxy" (formerly middleware). Two jobs:
 *
 *  1. Content-Security-Policy with a per-request nonce. A static `script-src
 *     'self'` blocks Next's inline RSC/bootstrap scripts, breaking hydration;
 *     the nonce + `strict-dynamic` is the recommended strict policy that lets
 *     exactly those scripts run. The nonce is exposed as `x-nonce` for the root
 *     layout to stamp onto its own inline bootstrap script.
 *  2. A cheap auth gate for protected routes: with no session cookie, redirect
 *     to /login immediately (no DB). The database session is still fully
 *     validated server-side in the page via `auth()`.
 */
const PROTECTED = [/^\/dashboard(?:\/|$)/, /^\/plans(?:\/|$)/];

function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style *attributes* (React `style` props, Next's critical CSS) need
    // 'unsafe-inline' — a nonce does not cover style attributes.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(req: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // Next.js reads the nonce from this request header and applies it to its scripts.
  requestHeaders.set("content-security-policy", csp);

  const pathname = req.nextUrl.pathname;
  if (PROTECTED.some((re) => re.test(pathname)) && !req.cookies.get(SESSION_COOKIE_NAME)?.value) {
    // Pin the redirect base to the canonical app URL. Middleware currently emits
    // a RELATIVE Location, so this already resolves against the real domain — but
    // pinning to NEXTAUTH_URL keeps it correct even if that changes and matches
    // the Strava OAuth routes (whose absolute redirects DID bounce to the proxy's
    // internal localhost Host). Read the env var directly (inlined at build), not
    // the zod-validated env module which shouldn't enter edge middleware; fall
    // back to req.url if unset.
    const loginUrl = new URL("/login", process.env.NEXTAUTH_URL || req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set("content-security-policy", csp);
    return redirect;
  }

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
}

export const config = {
  // Run on every page route; skip API, Next internals, and static files.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
