import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { handleApiError } from "@/lib/api";
import { sendWeeklyDigests } from "@/lib/digest";
import { logger } from "@/lib/logger";
import { pruneExpiredAuthRows } from "@/lib/retention";
import { enforceRateLimit } from "@/lib/security";
import { syncAllStravaConnections } from "@/lib/strava/cron-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerMatches(req: NextRequest, secret: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const presented = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/**
 * POST /api/cron/weekly-digest — send every due weekly digest email, and sweep
 * expired auth rows on the way past.
 *
 * Meant for a daily scheduler (Hetzner cron + curl; see DEPLOY.md), not
 * browsers, so the guard is a bearer secret rather than session + CSRF. The
 * batch is idempotent (per-user lastDigestWeek), so an accidental double run
 * sends nothing twice. 503 when CRON_SECRET is unset — the feature is off
 * until deployment opts in.
 *
 * Despite the name this is the daily maintenance tick, and two other jobs ride
 * along on it rather than taking routes of their own: a second cron entry is a
 * second thing to remember on every deploy, and a job nobody schedules does
 * nothing. Both run BEFORE the digest and neither can block it — whatever they
 * throw is logged and stepped over, because no amount of housekeeping is worth
 * losing a day of emails.
 *
 * - The retention sweep (src/lib/retention.ts) deletes expired auth rows.
 * - The Strava sync (src/lib/strava/cron-sync.ts) is what keeps connected
 *   athletes' data current at all: syncStravaActivities otherwise runs only
 *   when somebody presses "Sync now", and the Strava webhook covers
 *   deauthorization only. Ordered before the digest deliberately — the emails
 *   quote this week's distances, so syncing after them would post numbers a
 *   day stale.
 */
export async function POST(req: NextRequest) {
  if (!env.CRON_SECRET) {
    return NextResponse.json({ error: "Cron is not configured." }, { status: 503 });
  }

  // Auth first, throttle only FAILED attempts: the rate-limit bucket is shared
  // per IP (and falls back to one global bucket behind a proxy with
  // TRUSTED_PROXY_COUNT=0), so counting authenticated runs would let random
  // scanner noise 429 the one legitimate daily cron request. Brute force still
  // burns the bucket — every wrong-secret attempt is counted.
  if (!bearerMatches(req, env.CRON_SECRET)) {
    const limited = enforceRateLimit(req, "cron:digest", 10, 60_000);
    if (limited) return limited;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pruned = await pruneExpiredAuthRows().catch((error: unknown) => {
    logger.warn("Retention sweep failed; continuing with the digest batch", { error });
    return null;
  });

  const strava = await syncAllStravaConnections().catch((error: unknown) => {
    logger.warn("Strava sync batch failed; continuing with the digest batch", { error });
    return null;
  });

  try {
    const result = await sendWeeklyDigests();
    return NextResponse.json({ ok: true, ...result, pruned, strava }, { status: 200 });
  } catch (error) {
    return handleApiError(error, { route: "POST /api/cron/weekly-digest" });
  }
}
