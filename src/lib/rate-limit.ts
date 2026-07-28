/**
 * Minimal in-memory fixed-window rate limiter.
 *
 * NOTE: in-memory means per-process — it resets on restart and is not shared
 * across multiple server instances. It is sufficient for a single-node
 * deployment and for local testing; for production behind multiple instances,
 * back this with Redis / Upstash (same interface).
 */
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Housekeeping bounds. A bucket is created per (route name, client IP) and
 * nothing removes it when its window closes, so without this the map is a slow
 * leak in normal use and a fast one under a spray of distinct source IPs.
 */
const SWEEP_INTERVAL_MS = 60_000;
/** Hard ceiling on live buckets. ~100 bytes each, so this is single-digit MB. */
const MAX_BUCKETS = 20_000;
let lastSweepAt = 0;

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  maintain(now);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  if (bucket.count >= limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }

  bucket.count += 1;
  return { ok: true, remaining: limit - bucket.count, retryAfterSeconds: 0 };
}

/**
 * Called on every `rateLimit`, but does real work at most once a minute — the
 * sweep is O(buckets) and the whole point is to stay cheap during the traffic
 * spike that makes the map big in the first place.
 */
function maintain(now: number): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  sweepRateLimiter(now);

  // Everything left is a LIVE window, so there is nothing safe to drop — but
  // an unbounded map is worse than an imperfect limiter. Evict the buckets
  // closest to expiry: they were about to reset anyway, which also means
  // flooding the map is a poor way to clear your own counter (a fresh bucket
  // has the latest resetAt, so it is the last thing to go).
  if (buckets.size <= MAX_BUCKETS) return;
  const byExpiry = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  const excess = byExpiry.length - MAX_BUCKETS;
  for (const [key] of byExpiry.slice(0, excess)) {
    buckets.delete(key);
  }
}

/**
 * Drop every bucket whose window has closed. Called from `maintain`; exported
 * for tests and for a caller that wants to reclaim memory on demand.
 */
export function sweepRateLimiter(now: number = Date.now()): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Test seam: buckets are module state, so suites must start from empty. */
export function __resetRateLimiterForTests(): void {
  buckets.clear();
  lastSweepAt = 0;
}

/** Live bucket count — for tests and diagnostics. */
export function rateLimiterSize(): number {
  return buckets.size;
}
