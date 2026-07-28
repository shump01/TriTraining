import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Client IP for rate limiting, resistant to `X-Forwarded-For` spoofing.
 *
 * XFF is a client-controllable, comma-separated list; each proxy the request
 * passes through APPENDS the address it saw. So the only trustworthy entry is
 * the one added by the outermost proxy WE control — `TRUSTED_PROXY_COUNT` hops
 * from the right. Everything to the left of that is attacker-supplied and must
 * be ignored, otherwise an attacker rotates a fake leftmost IP per request to
 * mint a fresh rate-limit bucket each time (defeating brute-force throttles).
 *
 * With `TRUSTED_PROXY_COUNT = 0` (default) we don't trust XFF at all and fall
 * back to `x-real-ip` / a constant — the fail-safe (over-throttle, never
 * under-throttle). Production must set it to match the real proxy depth.
 */
export function getClientIp(req: NextRequest): string {
  const trusted = env.TRUSTED_PROXY_COUNT;
  if (trusted > 0) {
    const forwarded = req.headers.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        // Count `trusted` hops back from the right; clamp so an over-large
        // config or a short (spoofed) header can't index out of bounds.
        const ip = parts[Math.max(0, parts.length - trusted)];
        if (ip) return ip;
      }
    }
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

/** Default request-body ceiling: generous for JSON, far below a memory risk. */
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

/**
 * Reject an over-large request body BEFORE `req.json()` buffers it.
 *
 * Routes parse JSON with `await req.json()`, which reads the whole body into
 * memory first; zod's per-field caps only apply after that. Content-Length is
 * advisory (a chunked request omits it), so this is a cheap first gate rather
 * than a hard guarantee — the real ceiling belongs at the reverse proxy
 * (`client_max_body_size`), which DEPLOY.md documents.
 *
 * Usage, alongside the other guards at the top of a handler:
 *   const tooBig = enforceBodyLimit(req, HEALTH_INGEST_MAX_BODY_BYTES);
 *   if (tooBig) return tooBig;
 */
export function enforceBodyLimit(
  req: NextRequest,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): NextResponse | null {
  const header = req.headers.get("content-length");
  if (!header) return null;
  const length = Number(header);
  if (!Number.isFinite(length) || length <= maxBytes) return null;
  return NextResponse.json({ error: "Request body is too large." }, { status: 413 });
}
