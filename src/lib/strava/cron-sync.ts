import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

import { syncStravaActivities } from "./sync";

/**
 * Unattended Strava sync for the daily cron.
 *
 * Until this existed, syncStravaActivities only ever ran from POST
 * /api/strava/sync — i.e. when somebody pressed "Sync now". The Strava webhook
 * handles deauthorization only, so an athlete who stopped pressing the button
 * silently stopped having Strava data: their weeks fell back to whatever other
 * source was connected, with nothing on screen saying so.
 *
 * The batch is deliberately bounded rather than "sync everyone". Strava's rate
 * limit is charged to the APPLICATION, not the athlete, so an unbounded run
 * spends one shared quota on behalf of every user — and the athlete who pays
 * for it is whoever presses "Sync now" next and gets a partial result.
 */

/**
 * Users per run. At a few requests each (token refresh plus activity pages)
 * this stays clear of Strava's daily application quota while leaving room for
 * interactive syncs, which matter more because someone is watching them.
 */
const MAX_USERS_PER_RUN = 50;

/**
 * Don't re-sync an athlete synced this recently. The cron is daily, so this
 * normally changes nothing — it exists so that scheduling the tick hourly
 * (or running it twice by hand) can't turn into an API spend multiplier, and
 * so a run minutes after someone pressed "Sync now" skips them.
 */
const MIN_RESYNC_MS = 6 * 60 * 60 * 1000;

/**
 * Keep syncing a plan's athlete for a week past race day. Their final week is
 * still filling in, and dropping them the morning after the race would freeze
 * the very week they most want to look at.
 */
const PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export interface StravaSyncBatchResult {
  considered: number;
  synced: number;
  /** Connected row exists but the token is revoked/undecryptable. */
  skipped: number;
  failures: number;
  /** True if Strava rate-limited us and the batch stopped early. */
  rateLimited: boolean;
}

export async function syncAllStravaConnections(
  now: Date = new Date(),
  options: { maxUsers?: number; minResyncMs?: number } = {},
): Promise<StravaSyncBatchResult> {
  const maxUsers = options.maxUsers ?? MAX_USERS_PER_RUN;
  const minResyncMs = options.minResyncMs ?? MIN_RESYNC_MS;

  const connections = await prisma.stravaConnection.findMany({
    where: {
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - minResyncMs) } }],
      // Only athletes with a plan still in play. A sync for someone whose
      // races are all long past writes rows nobody reads, on a quota someone
      // else needs.
      user: {
        trainingPlans: { some: { eventDate: { gte: new Date(now.getTime() - PLAN_GRACE_MS) } } },
      },
    },
    // Stalest first, so a run that stops early still makes progress and the
    // same athletes aren't served every day while the tail starves.
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
    take: maxUsers,
    select: { userId: true },
  });

  const result: StravaSyncBatchResult = {
    considered: connections.length,
    synced: 0,
    skipped: 0,
    failures: 0,
    rateLimited: false,
  };

  for (const { userId } of connections) {
    try {
      const outcome = await syncStravaActivities(userId);
      if (!outcome.ok) {
        // Revoked on Strava's side, or the stored token no longer decrypts.
        // Not an error: the athlete disconnected and we find out here.
        result.skipped += 1;
        continue;
      }
      result.synced += 1;

      // Stop the whole batch, not just this athlete. The quota is the
      // application's, so pressing on would spend the rest of the run
      // collecting 429s and leave the interactive path rate-limited too.
      // Whoever we didn't reach sorts to the front of tomorrow's run.
      if (outcome.rateLimited) {
        result.rateLimited = true;
        logger.warn("Strava rate limit hit; stopping the sync batch early", {
          synced: result.synced,
          considered: result.considered,
        });
        break;
      }
    } catch (error) {
      // One athlete's network blip or bad row must not cost everyone behind
      // them in the queue their sync.
      logger.error("Scheduled Strava sync failed for user", { error, userId });
      result.failures += 1;
    }
  }

  return result;
}
