import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

/**
 * The database readiness probe behind GET /api/health, kept here rather than in
 * the route because it carries state: a short-lived cached result and an
 * in-flight promise.
 *
 * `/api/health` is deliberately unauthenticated (an uptime monitor holds no
 * credentials), which made it the one public route that ran a query per
 * request. These two together bound that to at most one `SELECT 1` per
 * PROBE_TTL_MS no matter how fast anyone calls it.
 */

/**
 * How long one probe result is reused. A monitor polling every 10-30s still
 * gets a fresh answer every time; a flood shares one. Short enough that a
 * database that has just fallen over is reported as down within seconds.
 */
export const PROBE_TTL_MS = 5_000;

export interface Probe {
  healthy: boolean;
  /** Round-trip time of the query that produced this result. */
  latencyMs: number;
  /** When this result was taken — the cache key, effectively. */
  at: number;
}

let cached: Probe | null = null;
let inFlight: Promise<Probe> | null = null;

async function runProbe(): Promise<Probe> {
  const startedAt = Date.now();
  try {
    // Cheapest possible round-trip that proves the connection is live.
    await prisma.$queryRaw`SELECT 1`;
    return { healthy: true, latencyMs: Date.now() - startedAt, at: Date.now() };
  } catch (error) {
    logger.error("Health check: database connectivity failed", { route: "GET /api/health", error });
    // Resolves rather than throws: a probe that cannot reach the database has
    // succeeded at its job — the answer is "unhealthy", not an exception. That
    // also keeps the failure inside the cache, so a database that is down does
    // not get hammered with one connection attempt per request.
    return { healthy: false, latencyMs: Date.now() - startedAt, at: Date.now() };
  }
}

export function probeDatabase(now: number = Date.now()): Promise<Probe> {
  if (cached && now - cached.at < PROBE_TTL_MS) return Promise.resolve(cached);

  // Collapse concurrent misses onto one query: N simultaneous requests should
  // cost one round-trip, not N. Without this the cache does nothing against
  // exactly the burst it exists to absorb.
  inFlight ??= runProbe()
    .then((probe) => {
      cached = probe;
      return probe;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Test seam: the cache is module state, so suites must start from empty. */
export function __resetHealthProbeForTests(): void {
  cached = null;
  inFlight = null;
}
