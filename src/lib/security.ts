import { NextResponse, type NextRequest } from "next/server";

import { rateLimit } from "@/lib/rate-limit";

/**
 * Best-effort client IP for rate limiting. Reads `x-forwarded-for` (first hop)
 * then `x-real-ip`. Only trustworthy behind a proxy that sets these headers;
 * configure your proxy accordingly in production.
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "127.0.0.1";
}

/**
 * CSRF defense for state-changing endpoints.
 *
 * Returns true when the request looks cross-site and should be rejected. Modern
 * browsers send `Sec-Fetch-Site`; we reject `cross-site`. We also reject when an
 * `Origin` header is present but its host disagrees with the `Host` header.
 * Requests with neither header (curl, server-to-server) are allowed through —
 * the httpOnly + sameSite=lax session cookie is the second line of defense.
 */
export function isCrossSiteRequest(req: NextRequest): boolean {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite === "cross-site") return true;

  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host");
    try {
      if (host && new URL(origin).host !== host) return true;
    } catch {
      return true; // malformed Origin
    }
  }

  return false;
}

/**
 * Fixed-window rate limit keyed by `name` + client IP. Returns a ready-to-send
 * 429 response when the caller is over the limit, or `null` to proceed.
 *
 * Usage at the top of a handler:
 *   const limited = enforceRateLimit(req, "plans:write", 30, 60_000);
 *   if (limited) return limited;
 */
export function enforceRateLimit(
  req: NextRequest,
  name: string,
  limit: number,
  windowMs: number,
): NextResponse | null {
  const result = rateLimit(`${name}:${getClientIp(req)}`, limit, windowMs);
  if (result.ok) return null;
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    { status: 429, headers: { "Retry-After": String(result.retryAfterSeconds) } },
  );
}
