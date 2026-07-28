import { NextResponse } from "next/server";

import { probeDatabase } from "@/lib/health-probe";

// Always evaluate at request time — a health check must never be cached.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/health
 *
 * Liveness + readiness probe. Returns 200 when the app is up AND the database
 * is reachable; 503 when the database connectivity check fails.
 *
 * Deliberately unauthenticated — an uptime monitor holds no credentials, and a
 * probe you have to sign in to use is not a probe. That made it the one public
 * route that hit the database once per request; `probeDatabase` caps that at
 * one query per PROBE_TTL_MS however fast anyone calls it.
 *
 * No rate limit here, on purpose. It would not protect the database (the cache
 * already does) and a 429 is indistinguishable from an outage to most monitors
 * — so with `TRUSTED_PROXY_COUNT` unset, where every caller shares one bucket
 * (see getClientIp), a passing scanner could spend the budget and page someone
 * at 3am about a site that is perfectly healthy. Throttling request volume as
 * such belongs at the reverse proxy, which is also where `/` is protected.
 */
export async function GET() {
  const probe = await probeDatabase();

  return NextResponse.json(
    {
      status: probe.healthy ? "ok" : "error",
      database: probe.healthy ? "connected" : "disconnected",
      // Healthy path only. How long a FAILING probe took is a timing detail
      // about the internals; it belongs in the log, not in a public response.
      ...(probe.healthy ? { latencyMs: probe.latencyMs } : {}),
      timestamp: new Date().toISOString(),
    },
    { status: probe.healthy ? 200 : 503 },
  );
}
